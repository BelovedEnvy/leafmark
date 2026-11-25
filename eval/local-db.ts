import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { SAMPLE,type Indexed,type Chunk } from "../lib/types";
import type { Search } from "../lib/answer";

// Only Supabase-owned roles and catalog tables are stubbed. The app migration runs verbatim.
export async function localDatabase() {
  const db=new PGlite({extensions:{vector}});
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema public,storage,auth to authenticated,anon,service_role;
    grant select,insert on storage.objects to authenticated;
  `);
  await db.exec(readFileSync("supabase/migrations/001_leafmark.sql","utf8"));
  await db.exec(readFileSync("supabase/migrations/002_restrict_search.sql","utf8"));
  return db;
}
export async function loadIndex(db:PGlite,chunks:Indexed[],pages:number) {
  await db.transaction(async tx=>{
    await tx.query("delete from public.documents where id=$1",[SAMPLE]);
    await tx.query("insert into public.documents(id,file_name,mode) values($1,$2,'fixed')",[SAMPLE,chunks[0].file_name]);
    await tx.query("select public.finish_index($1,$2,'fixed',$3::jsonb)",[SAMPLE,pages,JSON.stringify(chunks)]);
  });
}
export function localSearch(db:PGlite):Search {
  return async(q,v,hybrid)=>(await db.query<Chunk>("select * from public.search_chunks($1,$2,$3,$4)",[SAMPLE,q,JSON.stringify(v),hybrid])).rows;
}
