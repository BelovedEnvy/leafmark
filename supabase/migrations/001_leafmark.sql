begin;

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
set local search_path = public, extensions, pg_catalog;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 180),
  mode text not null check (mode in ('fixed','semantic')),
  overlap real not null default 0 check (overlap in (0, 0.15::real)),
  status text not null default 'pending' check (status in ('pending','ready','deleting')),
  pages smallint check (pages between 1 and 50),
  created_at timestamptz not null default now(),
  check (owner_id is not null or id = '00000000-0000-4000-8000-000000000001')
);
create index documents_owner on public.documents(owner_id);
create table public.chunks (
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_id text not null,
  header text not null,
  body text not null check (length(body)>0),
  spans jsonb not null check (jsonb_typeof(spans)='array' and jsonb_array_length(spans)>0),
  embedding extensions.vector(768) not null,
  terms tsvector generated always as (to_tsvector('english'::regconfig,body)) stored,
  primary key (document_id,chunk_id)
);
create index chunks_fts on public.chunks using gin(terms);
create index chunks_vector on public.chunks using hnsw(embedding extensions.vector_cosine_ops);
create table public.request_counts (
  bucket timestamptz not null, subject text not null, uses integer not null,
  primary key(bucket,subject)
);
alter table public.documents enable row level security;
alter table public.chunks enable row level security;
alter table public.request_counts enable row level security;
create policy visible_documents on public.documents for select to anon, authenticated
  using ((owner_id is null and status='ready') or owner_id=(select auth.uid()));
create policy visible_chunks on public.chunks for select to anon, authenticated
  using (exists (select 1 from public.documents d where d.id=document_id and d.status='ready'));
revoke all on public.documents, public.chunks, public.request_counts from public,anon,authenticated;
grant select on public.documents,public.chunks to anon,authenticated;
grant all on public.documents,public.chunks,public.request_counts to service_role;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
  values ('pdfs','pdfs',false,10485760,array['application/pdf']);
create policy upload_reserved_pdf on storage.objects for insert to authenticated with check (
  bucket_id='pdfs' and exists (select 1 from public.documents d where d.owner_id=(select auth.uid())
    and d.status='pending' and name=d.owner_id::text||'/'||d.id::text||'.pdf')
);
create policy read_own_pdf on storage.objects for select to authenticated using (
  bucket_id='pdfs' and exists (select 1 from public.documents d where d.owner_id=(select auth.uid())
    and d.status<>'deleting' and name=d.owner_id::text||'/'||d.id::text||'.pdf')
);

create function public.reserve_document(p_owner uuid,p_name text,p_mode text,p_overlap real) returns uuid
language plpgsql set search_path='' as $$
declare new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  if (select count(*) from public.documents where owner_id=p_owner)>=10 then
    raise exception 'Document limit reached' using errcode='P0001';
  end if;
  insert into public.documents(owner_id,file_name,mode,overlap) values(p_owner,p_name,p_mode,p_overlap)
    returning id into new_id;
  return new_id;
end $$;

-- A completed retry sees the existing index. Concurrent deletion wins over publication.
create function public.finish_index(p_id uuid,p_pages integer,p_mode text,p_chunks jsonb) returns void
language plpgsql set search_path=public,extensions,pg_catalog as $$
declare current_status text;
begin
  select status into strict current_status from public.documents where id=p_id for update;
  if current_status='ready' then return; end if;
  if current_status<>'pending' or jsonb_array_length(p_chunks)=0 then raise exception 'Index unavailable'; end if;
  insert into public.chunks(document_id,chunk_id,header,body,spans,embedding)
    select p_id,c.chunk_id,c.header,c.body,c.spans,c.embedding::text::extensions.vector
    from jsonb_to_recordset(p_chunks) as c(chunk_id text,header text,body text,spans jsonb,embedding jsonb);
  update public.documents set status='ready',pages=p_pages,mode=p_mode where id=p_id;
end $$;

create function public.take_request(p_subject text,p_limit integer) returns boolean
language plpgsql set search_path='' as $$
declare allowed boolean;
begin
  delete from public.request_counts where bucket<date_trunc('hour',now())-interval '1 hour';
  insert into public.request_counts as c values(date_trunc('hour',now()),p_subject,1)
    on conflict(bucket,subject) do update set uses=c.uses+1 where c.uses<p_limit
    returning true into allowed;
  return coalesce(allowed,false);
end $$;

create function public.search_chunks(p_doc uuid,p_query text,p_vector extensions.vector(768),p_hybrid boolean)
returns table (chunk_id text,file_name text,header text,body text,spans jsonb)
language sql stable security invoker set search_path=public,extensions,pg_catalog as $$
  with candidates as materialized (
    select c.chunk_id,c.embedding <=> p_vector as distance,
      case when p_hybrid then ts_rank_cd(c.terms,websearch_to_tsquery('english',p_query)) else 0 end as lexical
    from public.chunks c where c.document_id=p_doc
  ), dense as (
    select c.chunk_id,row_number() over(order by distance,c.chunk_id) as n from candidates c order by n limit 40
  ), sparse as (
    select c.chunk_id,row_number() over(order by lexical desc,c.chunk_id) as n from candidates c
    where lexical>0 order by n limit 40
  ), fused as (
    select coalesce(d.chunk_id,s.chunk_id) as id,
      coalesce(1.0/(60+d.n),0)+coalesce(1.0/(60+s.n),0) as score
    from dense d full join sparse s using(chunk_id)
  )
  select c.chunk_id,doc.file_name,c.header,c.body,c.spans from fused f
    join public.chunks c on c.document_id=p_doc and c.chunk_id=f.id join public.documents doc on doc.id=c.document_id
    where doc.status='ready' order by f.score desc,c.chunk_id limit 20;
$$;
revoke all on function public.reserve_document(uuid,text,text,real), public.finish_index(uuid,integer,text,jsonb),
  public.take_request(text,integer),public.search_chunks(uuid,text,extensions.vector,boolean) from public,anon,authenticated;
grant execute on function public.reserve_document(uuid,text,text,real),public.finish_index(uuid,integer,text,jsonb),
  public.take_request(text,integer) to service_role;
grant execute on function public.search_chunks(uuid,text,extensions.vector,boolean) to anon,authenticated,service_role;
grant usage on schema extensions to anon,authenticated,service_role;
commit;

