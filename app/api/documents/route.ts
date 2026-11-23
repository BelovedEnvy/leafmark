import { z } from "zod";
import { admin,configured,handle,limit,payload,session,uploadOptions } from "@/lib/http";
import { Problem } from "@/lib/types";
import { readPdf } from "@/lib/pdf";
import { indexDocument } from "@/lib/chunks";
import examples from "@/lib/examples.json";
export const maxDuration=300;

const sample={id:"sample",name:"Alder Beck Field Station",url:"/sample.pdf",status:"ready"};
type Row={id:string;owner_id:string;file_name:string;status:string};
const pathFor=(row:Row)=>row.owner_id+"/"+row.id+".pdf";
async function present(row:Row) {
  let url="";
  if(row.status==="ready"){
    const {data,error}=await admin().storage.from("pdfs").createSignedUrl(pathFor(row),3600);
    if(error) throw error;url=data.signedUrl;
  }
  return {id:row.id,name:row.file_name,status:row.status,url};
}

export async function GET(req:Request){return handle(async()=>{
  const documents=[sample];
  if(req.headers.has("authorization")){
    const {db,user}=await session(req,true);
    const {data,error}=await db.from("documents").select("id,owner_id,file_name,status").eq("owner_id",user!.id).order("created_at",{ascending:false});
    if(error) throw error;
    documents.push(...await Promise.all((data??[]).map(present)));
  }
  return {documents,configured:configured(),sample:examples[0],suggestions:examples.map(e=>e.question)};
});}

export async function POST(req:Request){return handle(async()=>{
  const {db,user}=await session(req,true);
  const input=await payload(req,uploadOptions.extend({path:z.string().max(100)}));
  const id=input.path.split("/")[1]?.replace(/\.pdf$/,"");
  if(!z.uuid().safeParse(id).success || input.path!==user!.id+"/"+id+".pdf") throw new Problem(400,"Invalid upload path.");
  const {data:row,error}=await db.from("documents").select("*").eq("id",id).eq("owner_id",user!.id).maybeSingle();
  if(error) throw error;
  if(!row || row.status==="deleting") throw new Problem(404,"Document unavailable.");
  if(row.status==="ready") return {document:await present(row as Row)};
  await limit(req,"index",user!.id);
  const {data:file,error:storageError}=await db.storage.from("pdfs").download(input.path);
  if(storageError||!file) throw new Problem(409,"Finish uploading the PDF first.");
  const {spans,pages}=await readPdf(new Uint8Array(await file.arrayBuffer()));
  const {chunks,mode,notice}=await indexDocument(spans,row.file_name,row.mode,row.overlap);
  const {error:writeError}=await admin().rpc("finish_index",{p_id:id,p_pages:pages,p_mode:mode,p_chunks:chunks});
  if(writeError) throw writeError;
  return {document:await present({...row,status:"ready"} as Row),notice};
});}

export async function DELETE(req:Request){return handle(async()=>{
  const {user}=await session(req,true);
  const {id}=await payload(req,z.object({id:z.uuid()}));
  const db=admin();
  const {data:row,error}=await db.from("documents").update({status:"deleting"}).eq("owner_id",user!.id).eq("id",id).select("*").maybeSingle();
  if(error) throw error;
  if(row){
    const {error:storageError}=await db.storage.from("pdfs").remove([pathFor(row as Row)]);
    if(storageError) throw storageError;
    const {error:deleteError}=await db.from("documents").delete().eq("id",id).eq("owner_id",user!.id);
    if(deleteError) throw deleteError;
  }
  return {deleted:true};
});}
