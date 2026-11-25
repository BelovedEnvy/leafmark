import type { Chunk } from "../lib/types";
import { clean } from "../lib/answer";
import golden from "./golden_dataset.json";
export type Gold=typeof golden[number];
export type Trial={rank:number;unanswerable:boolean;abstained:boolean;failedVerification:boolean;faithful:boolean|null;matched:number;attempted:number;ms:number;contradictionCovered?:boolean};
const plain=(s:string)=>clean(s.replaceAll("|"," ").replace(/-{3,}/g," "));
export function firstRelevant(q:Gold,chunks:Chunk[]) {
  const rank=chunks.slice(0,5).findIndex(c=>q.supporting_passages.some(p=>
    plain(c.spans.filter(s=>s.page===p.page).map(s=>s.text).join(" ")).includes(plain(p.quote))));
  return rank+1;
}
export function coversContradiction(q:Gold,chunks:Chunk[]) {
  return q.supporting_passages.every(p=>firstRelevant({...q,supporting_passages:[p]},chunks)>0);
}
export function summarize(records:Trial[]) {
  const answerable=records.filter(r=>!r.unanswerable),unknown=records.filter(r=>r.unanswerable);
  const judged=records.filter(r=>r.faithful!==null);
  const ratio=(n:number,d:number)=>d?n/d:null;
  const contradictions=records.filter(r=>r.contradictionCovered!==undefined);
  return {hit_rate:ratio(answerable.filter(r=>r.rank>0).length,answerable.length),
    mrr:ratio(answerable.reduce((n,r)=>n+(r.rank?1/r.rank:0),0),answerable.length),
    faithfulness:ratio(judged.filter(r=>r.faithful).length,judged.length),
    quote_verification:ratio(records.reduce((n,r)=>n+r.matched,0),records.reduce((n,r)=>n+r.attempted,0)),
    abstention_accuracy:ratio(unknown.filter(r=>r.abstained && !r.failedVerification).length,unknown.length),
    avg_latency_ms:Math.round(records.reduce((n,r)=>n+r.ms,0)/records.length),
    ...(contradictions.length ? {contradiction_coverage:ratio(contradictions.filter(r=>r.contradictionCovered).length,contradictions.length)} : {})};
}
