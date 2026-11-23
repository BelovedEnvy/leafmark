export type Box = [number, number, number, number];
export type Span = { text: string; page: number; box: Box };
export type Chunk = { chunk_id: string; file_name: string; header: string; body: string; spans: Span[] };
export type Indexed = Chunk & { embedding: number[] };
export type Mode = "fixed" | "semantic";
export const SAMPLE = "00000000-0000-4000-8000-000000000001";
export class Problem extends Error {
  constructor(public status: number, message: string) { super(message); }
}

