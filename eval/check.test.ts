import assert from "node:assert/strict";
import {encode,decode} from "gpt-tokenizer/encoding/cl100k_base";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import { readPdf,layout } from "../lib/pdf";
import { chunkDocument,tokenCount } from "../lib/chunks";
import { verify,sourceXml,answer } from "../lib/answer";
import { models } from "../lib/models";
import { localDatabase,loadIndex,localSearch } from "./local-db";
import { firstRelevant,coversContradiction,summarize } from "./metrics";
import { SAMPLE,type Span,type Chunk } from "../lib/types";
import golden from "./golden_dataset.json";

const box:[number,number,number,number]=[.1,.2,.4,.02];
const span=(text:string,page=1):Span=>({text,page,box});
const vector=()=>[1,...Array<number>(767).fill(0)];
const chunk:Chunk={chunk_id:"c0001",body:"Use the north gate.",spans:[span("Use the north gate.")],header:"A passage from the manual.",file_name:"A & B.pdf"};

test("PDF, all reference passages, normalized coordinates, Markdown tables and retrieval corpus size",async()=>{
  const pdf=await readPdf(new Uint8Array(readFileSync("public/sample.pdf")));
  assert.equal(pdf.pages,38);assert.equal(golden.length,30);
  for(const s of pdf.spans) assert(s.box.every(n=>Number.isFinite(n)&&n>=0&&n<=1));
  const full={...chunk,spans:pdf.spans};
  for(const q of golden.filter(q=>q.kind!=="unanswerable")) assert.equal(firstRelevant(q,[full]),1,q.id);
  for(const q of golden)for(const p of q.supporting_passages)
    assert.equal(firstRelevant({...q,supporting_passages:[p]},[full]),1,q.id+" "+p.quote);
  const {chunks}=await chunkDocument(pdf.spans,"sample.pdf","fixed",0);
  assert(chunks.length>20);assert(pdf.spans.some(s=>s.text.includes("| ---")));
  console.log("Fixture:",pdf.pages,"pages,",pdf.spans.length,"positioned rows,",chunks.length,"fixed chunks.");
});
test("reject invalid PDF; aligned cells form a Markdown table",async()=>{
  await assert.rejects(readPdf(new Uint8Array(12)),/PDF/);
  const rows=layout(["Field","Target","Flow","12 L"].map((text,i)=>({text,box:[i%2*.5,.1+Math.floor(i/2)*.2,.1,.03]})),1);
  assert.equal(rows[0].text,"| Field | Target |\n| --- | --- |");assert.equal(rows[1].text,"| Flow | 12 L |");
});
test("512-token windows cover the original, overlap by 77 tokens and preserve Unicode",async()=>{
  const input=("snow station gate rain ".repeat(350)+"水位🙂 ").repeat(3);
  for(const overlap of [0,.15] as const){
    const {chunks}=await chunkDocument([span(input)],"sample","fixed",overlap);
    assert(chunks.every(c=>tokenCount(c.body)<=512 && !c.body.includes("\uFFFD")));
    if(!overlap) assert.equal(chunks.map(c=>c.body).join(""),input);
    else assert(chunks[1].body.startsWith(decode(encode(chunks[0].body).slice(-77))));
  }
});
test("semantic floor, cross-page coordinates and small-file fallback",async()=>{
  const short=await chunkDocument([span("Tiny.")],"x","semantic",0);
  assert.equal(short.mode,"fixed");assert(short.notice);
  const spans=Array.from({length:50},(_,i)=>span((" The observer checked the upstream gauge at noon.").repeat(3),1+(i>24?1:0)));
  const {chunks}=await chunkDocument(spans,"file","semantic",0,async texts=>texts.map(vector));
  assert(chunks.length>1);assert(chunks.every(c=>tokenCount(c.body)>=200));assert(chunks.some(c=>new Set(c.spans.map(s=>s.page)).size===2));
});
test("unverified claims withheld, verified boxes target the quote page, XML escapes metadata",()=>{
  const result=verify({claims:[{text:"Use the north gate.",sources:[{id:1,verbatim_quote:"north gate"}]},
    {text:"An unsupported claim",sources:[{id:4,verbatim_quote:"north gate"}]}],groundedness_score:1},[chunk]);
  assert.equal(result.text,"Use the north gate. [1]");assert.equal(result.attempted,2);assert.equal(result.matched,1);
  assert.deepEqual(result.citations[0].boxes,[box]);assert(sourceXml(chunk,0).includes("A &amp; B.pdf"));
});
test("CRAG retries once and abstains with actual related text on low relevance",async()=>{
  const oldFetch=globalThis.fetch,account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_ACCOUNT_ID="0".repeat(32);process.env.CLOUDFLARE_API_TOKEN="test";
  try{
    const calls:string[]=[];
    globalThis.fetch=async(input)=>{
      const url=String(input);calls.push(url);
      const result=url.endsWith(models.embedding)?{data:[{index:0,embedding:vector()}]}:
        url.endsWith(models.reranker)?{response:[{id:0,score:.01}]}:{response:{query:"rewritten query"}};
      return Response.json({success:true,result});
    };
    const res=await answer("Where is the stockroom?",async()=>[chunk]);
    assert(res.rewritten && res.abstained);assert.deepEqual(res.topics,[chunk.body]);assert.equal(calls.length,5);
  } finally {
    globalThis.fetch=oldFetch;
    if(account===undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;else process.env.CLOUDFLARE_ACCOUNT_ID=account;
    if(token===undefined) delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=token;
  }
});
test("retrieval trace preserves initial rank and reranker score",async()=>{
  const oldFetch=globalThis.fetch,account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_ACCOUNT_ID="0".repeat(32);process.env.CLOUDFLARE_API_TOKEN="test";
  try {
    globalThis.fetch=async input=>{
      const url=String(input);
      const result=url.endsWith(models.embedding)?{data:[{index:0,embedding:vector()}]}:
        url.endsWith(models.reranker)?{response:[{id:1,score:.9},{id:0,score:.5}]}:
        {response:{claims:[{text:'Use the gate.',sources:[{id:1,verbatim_quote:'north gate'}]}],groundedness_score:.9}};
      return Response.json({success:true,result});
    };
    const out=await answer('Which gate?',async()=>[{...chunk,chunk_id:'c0002'},chunk]);
    assert.deepEqual(out.trace.map(row=>row.hybrid_rank),[2,1]);
    assert.equal(out.citations[0].reranker_score,.9);
  } finally {
    globalThis.fetch=oldFetch;
    if(account===undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;else process.env.CLOUDFLARE_ACCOUNT_ID=account;
    if(token===undefined) delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=token;
  }
});
test("PostgreSQL migration, atomic publish, RRF, quota, owner isolation, bucket reservations and deletion",async()=>{
  const db=await localDatabase(),owner="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
  const item={...chunk,embedding:vector()};
  try{
    await loadIndex(db,[item],1);
    assert.equal((await localSearch(db)("north gate",vector(),true))[0].chunk_id,item.chunk_id);
    await db.query("insert into auth.users values($1),($2)",[owner,other]);
    const id=(await db.query<{id:string}>("select reserve_document($1,'private.pdf','fixed',0) as id",[owner])).rows[0].id;
    await assert.rejects(db.query("select finish_index($1,1,'fixed',$2)",[id,JSON.stringify([{...item,embedding:[0]}])]));
    assert.equal((await db.query<{status:string}>("select status from documents where id=$1",[id])).rows[0].status,"pending");
    await db.exec("set role authenticated");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
    await db.query("insert into storage.objects values('pdfs',$1)",[owner+"/"+id+".pdf"]);
    await assert.rejects(db.query("insert into storage.objects values('pdfs',$1)",[other+"/"+id+".pdf"]));
    await assert.rejects(db.query("select reserve_document($1,'forged','fixed',0)",[owner]));
    await db.exec("reset role");
    await db.query("select finish_index($1,1,'fixed',$2)",[id,JSON.stringify([item])]);
    await db.query("select finish_index($1,1,'fixed',$2)",[id,JSON.stringify([item])]);
    await db.exec("set role authenticated");
    assert.equal((await db.query("select * from public.documents")).rows.length,2);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
    assert.equal((await db.query("select * from public.documents")).rows.length,1);
    await assert.rejects(db.query("select * from public.search_chunks($1,'gate',$2,true)",[id,JSON.stringify(vector())]));
    assert.equal((await db.query("select * from storage.objects")).rows.length,0);
    await db.exec("reset role; set role anon");await db.exec("select set_config('request.jwt.claim.sub','',false)");
    assert.equal((await db.query<{id:string}>("select * from public.documents")).rows[0].id,SAMPLE);
    await assert.rejects(db.query("delete from public.documents where id=$1",[SAMPLE]));
    await db.exec("reset role");
    for(const expected of [true,false]){
      assert.equal((await db.query<{ok:boolean}>("select take_request('test',1) as ok")).rows[0].ok,expected);
    }
    await db.query("delete from public.documents where id=$1",[id]);
    assert.equal((await db.query<{n:number}>("select count(*)::int as n from public.chunks where document_id=$1",[id])).rows[0].n,0);
  }finally{await db.close();}
});
test("metric denominators exclude abstentions from judge scores and count raw rejected quotes",()=>{
  const trial={rank:2,unanswerable:false,abstained:false,failedVerification:false,faithful:true,matched:1,attempted:2,ms:100};
  const summary=summarize([trial,{...trial,unanswerable:true,abstained:true,faithful:null,attempted:0,matched:0,ms:200}]);
  assert.deepEqual(summary,{hit_rate:1,mrr:.5,faithfulness:1,quote_verification:.5,abstention_accuracy:1,avg_latency_ms:150});
});
test("contradiction coverage requires every supporting passage in the top five",()=>{
  const q={...golden[0],supporting_passages:[{page:1,quote:"north gate"},{page:2,quote:"south gate"}]};
  assert.equal(coversContradiction(q,[chunk]),false);
  assert.equal(coversContradiction(q,[chunk,{...chunk,spans:[span('south gate',2)]}]),true);
});
