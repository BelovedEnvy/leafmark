import { z } from "zod";
import { admin,configured,handle,limit,payload,session } from "@/lib/http";
import { Problem,SAMPLE,type Chunk } from "@/lib/types";
import { answer } from "@/lib/answer";
import examples from "@/lib/examples.json";
export const maxDuration=300;

export async function POST(req:Request){return handle(async()=>{
  const {documentId,question}=await payload(req,z.object({documentId:z.union([z.literal("sample"),z.uuid()]),question:z.string().trim().min(2).max(700)}));
  if(documentId==="sample"){
    const example=examples.find(e=>e.question.toLowerCase()===question.toLowerCase());
    if(example) return example.answer;
  }
  if(!configured()) throw new Problem(503,"Live questions need a connected index and inference account. The sample questions are ready to explore.");
  const {db,user}=await session(req,documentId!=="sample");
  const id=documentId==="sample"?SAMPLE:documentId;
  const {data:doc,error}=await db.from("documents").select("id").eq("id",id).eq("status","ready").maybeSingle();
  if(error) throw error;
  if(!doc) throw new Problem(documentId==="sample"?503:404,documentId==="sample"?"The sample index has not been seeded.":"Document unavailable.");
  await limit(req,"ask",user?.id);
  const result=await answer(question,async(q,v,hybrid)=>{
    const {data,error}=await admin().rpc("search_chunks",{p_doc:id,p_query:q,p_vector:v,p_hybrid:hybrid});
    if(error) throw error;
    return data as Chunk[];
  });
  const {retrieved,attempted,matched,...visible}=result;
  return visible;
});}
