# Leafmark

Ask questions about a PDF and inspect the cited passage on its page.

## Setup

Install Node.js 24 and run `npm ci`. Copy `.env.example` to `.env.local` and supply the listed Supabase and Cloudflare Workers AI credentials. Run `npm run dev` for local development. Apply the SQL migration to a new Supabase project, enable GitHub OAuth, configure the private `pdfs` bucket through the migration, and run `npm run seed` to index the public sample. Configure OAuth redirect URLs for the deployed domain.

The server uses Cloudflare Workers Free for EmbeddingGemma 2, BGE reranker and Llama 3.3. Built with Llama. Keep the Workers account on the Free plan to enforce its daily allowance. Inference stops when the allowance is exhausted.

## Architecture

PDF.js extracts positioned text and tabular rows. Chunk embeddings and full-text indexes live in Supabase Postgres. Hybrid retrieval uses reciprocal rank fusion and a cross-encoder, followed by a single corrective query rewrite when relevance is low. Answers cite verified verbatim passages. Documents and storage use per-owner row-level policies.

## Evaluation

Run `npm run eval` with Workers AI credentials. The local PGlite database runs the migration and pgvector. Results checkpoint by source fingerprint and update this table and `public/benchmarks.json` only after all four variants complete. The sample and golden questions are redistributable under CC0. Exact-quote verification counts all attempted citations. Faithfulness is an LLM judge over non-abstained answers. Retrieval metrics exclude unanswerable cases. Abstention accuracy covers unanswerable cases. Latency covers each question's retrieval and answer generation.

<!-- results:start -->
| Variant | Hit Rate@5 | MRR@5 | Faithfulness | Exact quotes | Abstention | Mean ms |
|---|---:|---:|---:|---:|---:|---:|
| Fixed 0% | 91.7% | 0.799 | 95.5% | 100.0% | 100.0% | 4762 |
| Fixed 15% | 91.7% | 0.792 | 95.7% | 97.0% | 100.0% | 4751 |
| Semantic | 91.7% | 0.875 | 95.7% | 100.0% | 100.0% | 3932 |
| Semantic + hybrid + reranker | 95.8% | 0.878 | 94.1% | 100.0% | 100.0% | 4572 |
<!-- results:end -->
