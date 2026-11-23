import { admin,configured,handle,limit,payload,session,uploadOptions } from "@/lib/http";
import { Problem } from "@/lib/types";

export async function POST(req:Request) { return handle(async()=>{
  if(!configured()) throw new Problem(503,"Connect storage and inference before uploading.");
  const {user}=await session(req,true);
  const {name,mode,overlap}=await payload(req,uploadOptions);
  await limit(req,"upload",user!.id);
  const {data:id,error}=await admin().rpc("reserve_document",{p_owner:user!.id,p_name:name,p_mode:mode,p_overlap:overlap});
  if(error?.code==="P0001") throw new Problem(409,"Delete a PDF before adding another. Each account can keep ten.");
  if(error) throw error;
  return {id,path:user!.id+"/"+id+".pdf"};
});}
