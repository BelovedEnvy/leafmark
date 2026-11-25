import { z } from "zod";
import { Problem } from "./types";

export const models = {
  embedding: "@cf/google/embeddinggemma-2",
  reranker: "@cf/baai/bge-reranker-base",
  language: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
} as const;

async function infer(model: string, input: object): Promise<unknown> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Problem(503, "Inference is not configured.");
  if (!/^[a-f0-9]{32}$/i.test(account)) throw new Problem(503, "Check the Cloudflare account ID.");
  const response = await fetch("https://api.cloudflare.com/client/v4/accounts/" + account + "/ai/run/" + model, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(input), signal: AbortSignal.timeout(45_000), cache: "no-store",
  });
  const envelope = await response.json().catch(() => null);
  if (envelope?.errors?.some((e: {code:number;message?:string}) => e.code === 3036 ||
    (e.code === 4006 && e.message?.includes('daily free allocation'))))
    throw new Problem(429, "The free inference allowance is exhausted. It resets at 00:00 UTC.");
  if (response.status === 429) throw new Problem(429, "Inference is temporarily busy. Please try again shortly.");
  if (!response.ok || !envelope?.success) throw new Problem(502, "Inference provider could not complete the request (HTTP " + response.status + ").");
  return envelope.result;
}

export async function embed(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += 16) {
    const batch = texts.slice(start, start + 16);
    const result = z.object({data:z.array(z.object({index:z.number().int(), embedding:z.array(z.number()).length(768)})).length(batch.length)})
      .parse(await infer(models.embedding, {input:batch,dimensions:768,encoding_format:"float"}));
    result.data.sort((a,b) => a.index - b.index).forEach((item,i) => {
      if (item.index !== i) throw new Problem(502,"Invalid embedding order.");
      vectors.push(item.embedding);
    });
  }
  return vectors;
}

export async function rerank(query: string, passages: string[]) {
  if (!passages.length) return [];
  const schema = z.object({response:z.array(z.object({id:z.number().int().min(0).max(passages.length-1),score:z.number()}))});
  const { response } = schema.parse(await infer(models.reranker, { query, contexts:passages.map(text=>({text})), top_k:Math.min(5,passages.length) }));
  return response.sort((a,b)=>b.score-a.score).filter((row,i,all)=>all.findIndex(other=>other.id===row.id)===i).slice(0,5);
}

export async function generate<T extends z.ZodType>(schema: T, instruction: string, input: string): Promise<z.output<T>> {
  const result = await infer(models.language, {
    messages: [{role:"system",content:instruction},{role:"user",content:input}],
    response_format:{type:"json_schema",json_schema:z.toJSONSchema(schema)}, temperature:0,max_tokens:1200,stream:false,
  });
  const {response} = z.object({response:z.unknown()}).parse(result);
  try { return schema.parse(typeof response === "string" ? JSON.parse(response) : response); }
  catch { throw new Problem(502, "The model returned an incomplete structured answer. Please retry."); }
}
