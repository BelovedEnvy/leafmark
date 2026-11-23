import { encode, decode } from "gpt-tokenizer/encoding/cl100k_base";
import { embed } from "./models";
import type { Chunk, Span, Mode, Indexed } from "./types";

const tokens=(s:string)=>encode(s,{disallowedSpecial:new Set()});
export const tokenCount=(s:string)=>tokens(s).length;
type Range = [number,number];

// Resolve token windows to original character offsets, including UTF-8 characters split across tokens.
function windows(text:string, overlap:number): Range[] {
  const ids=tokens(text), ranges:Range[]=[];
  let start=0, offset=0;
  while(start<ids.length) {
    let end=Math.min(start+512,ids.length);
    while(end>start+1 && decode(ids.slice(start,end)).endsWith("\uFFFD") && end<ids.length) end--;
    const part=decode(ids.slice(start,end));
    ranges.push([offset,offset+part.length]);
    if(end===ids.length) break;
    let next=end-Math.min(Math.round(overlap*512),end-start-1);
    while(next>start+1 && decode(ids.slice(start,next)).endsWith("\uFFFD")) next--;
    offset+=decode(ids.slice(start,next)).length; start=next;
  }
  return ranges;
}

async function semantic(text:string, encoder:typeof embed):Promise<Range[]> {
  const sentences:Range[]=[];
  const segmenter=new Intl.Segmenter("en",{granularity:"sentence"});
  for(const s of segmenter.segment(text.replaceAll("\n"," "))) {
    for(const [a,b] of windows(s.segment,0)) sentences.push([s.index+a,s.index+b]);
  }
  const vectors=await encoder(sentences.map(([a,b])=>"task: clustering | query: "+text.slice(a,b)));
  const gaps=vectors.slice(1).map((v,i)=>{
    const u=vectors[i]; const dot=v.reduce((n,x,j)=>n+x*u[j],0);
    return 1-dot/(Math.hypot(...u)*Math.hypot(...v)||1);
  });
  const sorted=[...gaps].sort((a,b)=>a-b), threshold=sorted[Math.floor(sorted.length*.75)]??1;
  const ranges:Range[]=[]; let start=0;
  for(let i=0;i<sentences.length-1;i++) {
    const end=sentences[i][1], size=tokenCount(text.slice(start,end));
    if(size>=200 && (gaps[i]>=threshold || size>=512)) {
      ranges.push([start,end]); start=end;
    }
  }
  if(start<text.length && ranges.length && tokenCount(text.slice(start))<200) ranges[ranges.length-1][1]=text.length;
  else if(start<text.length) ranges.push([start,text.length]);
  return ranges;
}

export async function chunkDocument(spans:Span[],file:string,mode:Mode,overlap:0|0.15,encoder=embed) {
  const text=spans.map(s=>s.text).join("\n");
  if(!text.length) throw new Error("No text to index.");
  const fallback=mode==="semantic" && tokenCount(text)<200;
  const ranges=mode==="fixed"||fallback?windows(text,overlap):await semantic(text,encoder);
  let offset=0;
  const indexed=spans.map(s=>{ const start=offset; offset+=s.text.length+1; return {s,start,end:offset-1}; });
  let first=0;
  const chunks:Chunk[]=ranges.map(([a,b],i)=>{
    while(first<indexed.length && indexed[first].end<=a) first++;
    const parts:Span[]=[];
    for(let j=first;j<indexed.length && indexed[j].start<b;j++) {
      const {s,start,end}=indexed[j];
      const part=text.slice(Math.max(a,start),Math.min(b,end));
      if(part.length) parts.push({...s,text:part});
    }
    const page=parts[0]?.page??1, last=parts.at(-1)?.page??page;
    return {chunk_id:"c"+String(i+1).padStart(4,"0"),file_name:file,
      header:"This passage comes from "+file+", "+(page===last?"page "+page:"pages "+page+"–"+last)+".",
      body:text.slice(a,b),spans:parts};
  });
  return {chunks,mode:fallback?"fixed" as const:mode,notice:fallback?"Under 200 tokens. Indexed with fixed chunks.":undefined};
}

export async function indexDocument(spans:Span[],file:string,mode:Mode,overlap:0|0.15) {
  const result=await chunkDocument(spans,file,mode,overlap);
  const vectors=await embed(result.chunks.map(c=>"title: "+file+" | text: "+c.header+"\n"+c.body));
  const chunks:Indexed[]=result.chunks.map((c,i)=>({...c,embedding:vectors[i]}));
  return {...result,chunks};
}
