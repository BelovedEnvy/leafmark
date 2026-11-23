import { readFileSync, writeFileSync } from "node:fs";
import { readPdf } from "../lib/pdf";
import { chunkDocument } from "../lib/chunks";
import { locate } from "../lib/answer";
import golden from "../eval/golden_dataset.json";
const {spans}=await readPdf(new Uint8Array(readFileSync("public/sample.pdf")));
const {chunks}=await chunkDocument(spans,"Alder Beck Field Station.pdf","fixed",0.15);
const examples=golden.slice(0,3).map(q=>{
  const citations=q.supporting_passages.map((p,i)=>{
    for(const c of chunks){
      const hits=locate(c.spans.filter(s=>s.page===p.page),p.quote);
      if(hits.length) return {id:i+1,page:p.page,chunk_id:c.chunk_id,verbatim_quote:p.quote,boxes:hits.map(s=>s.box)};
    }
    throw new Error("Missing sample citation "+q.id);
  });
  return {question:q.question,answer:{text:q.expected_answer+" "+citations.map(c=>"["+c.id+"]").join(" "),citations,
    groundedness_score:null,abstained:false,example:true}};
});
writeFileSync("lib/examples.json",JSON.stringify(examples,null,2)+"\n");

