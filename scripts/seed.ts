import { readFileSync } from "node:fs";
import { admin } from "../lib/http";
import { readPdf } from "../lib/pdf";
import { indexDocument } from "../lib/chunks";
import { SAMPLE } from "../lib/types";
const db=admin(), file="Alder Beck Field Station.pdf";
const {error}=await db.from("documents").upsert({id:SAMPLE,file_name:file,mode:"semantic"},{onConflict:"id",ignoreDuplicates:true});
if(error) throw error;
const {data:doc,error:readError}=await db.from("documents").select("status").eq("id",SAMPLE).single();
if(readError) throw readError;
if(doc.status!=="ready"){
  const {spans,pages}=await readPdf(new Uint8Array(readFileSync("public/sample.pdf")));
  const {chunks,mode}=await indexDocument(spans,file,"semantic",0);
  const {error}=await db.rpc("finish_index",{p_id:SAMPLE,p_pages:pages,p_mode:mode,p_chunks:chunks});
  if(error) throw error;
}
console.log("Public sample index ready.");

