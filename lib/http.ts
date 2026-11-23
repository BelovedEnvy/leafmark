import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { Problem } from "./types";

export const configured=()=>Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  process.env.SUPABASE_SECRET_KEY && process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);

function connection(key:string|undefined, token?:string) {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  if(!url || !key) throw new Problem(503,"Document storage is not configured.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:token?{headers:{Authorization:"Bearer "+token}}:{}});
}
export const admin=()=>connection(process.env.SUPABASE_SECRET_KEY);
export async function session(req:Request,required=false) {
  const header=req.headers.get("authorization");
  if(header && !/^Bearer \S+$/.test(header)) throw new Problem(401,"Sign in again.");
  const token=header?.slice(7);
  const db=connection(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,token);
  if(!token && required) throw new Problem(401,"Sign in to manage PDFs.");
  if(!token) return {db,user:null};
  const {data,error}=await db.auth.getUser(token);
  if(error || !data.user) throw new Problem(401,"Your session expired. Sign in again.");
  return {db,user:data.user};
}
export const uploadOptions=z.object({name:z.string().trim().min(1).max(180),mode:z.enum(["fixed","semantic"]),overlap:z.union([z.literal(0),z.literal(.15)])});
export async function payload<T extends z.ZodType>(req:Request,schema:T):Promise<z.output<T>> {
  if(!req.headers.get("content-type")?.startsWith("application/json")) throw new Problem(415,"Send JSON.");
  const reader=req.body?.getReader(), parts:Uint8Array[]=[]; let size=0;
  if(!reader) throw new Problem(400,"Missing request.");
  while(true) {
    const {done,value}=await reader.read(); if(done) break;
    size+=value.length; if(size>8192){await reader.cancel();throw new Problem(413,"Request too large.");}parts.push(value);
  }
  try{return schema.parse(JSON.parse(Buffer.concat(parts).toString("utf8")));}
  catch{throw new Problem(400,"Check the request fields.");}
}

export async function limit(req:Request,kind:string,user?:string) {
  const identity=user || (process.env.VERCEL?req.headers.get("x-vercel-forwarded-for")?.split(",")[0]:"localhost") || "unknown";
  const hash=createHash("sha256").update(identity).digest("hex").slice(0,32);
  const db=admin();
  for(const [key,max] of [[kind+hash,kind==="ask"?15:10],[kind+":total",kind==="ask"?120:40]] as const) {
    const {data,error}=await db.rpc("take_request",{p_subject:key,p_limit:max});
    if(error) throw new Problem(503,"Usage limits could not be checked.");
    if(!data) throw new Problem(429,"Hourly request limit reached. Try again later.");
  }
}
export function json(data:unknown,status=200) {
  return Response.json(data,{status,headers:{"Cache-Control":"private, no-store"}});
}
export async function handle(run:()=>Promise<unknown>) {
  try{return json(await run());}catch(e){
    if(e instanceof Problem) return json({error:e.message},e.status);
    console.error("Leafmark request failed",e instanceof Error?e.name:"UpstreamError");
    return json({error:"The request could not be completed. Please retry."},503);
  }
}

