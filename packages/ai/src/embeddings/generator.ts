import { getEncoding, type Tiktoken } from 'js-tiktoken';
import OpenAI from 'openai';

import { calculateCostUsd, EMBEDDING_DIMENSIONS, MODELS } from '../llm/models';

const CHUNK_TOKENS = 512;
const CHUNK_OVERLAP = 50;
const EMBEDDING_MODEL = MODELS.embedding.id;

let openaiClient: OpenAI | null = null;
let encoder: Tiktoken | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = getEncoding('cl100k_base');
  }
  return encoder;
}

export type TextChunk = {
  index: number;
  text: string;
  tokenCount: number;
};

/**
 * Chunk text into ~512-token windows with 50-token overlap (tiktoken).
 */
export function chunkText(
  text: string,
  chunkSize = CHUNK_TOKENS,
  overlap = CHUNK_OVERLAP,
): TextChunk[] {
  const enc = getEncoder();
  const tokens = enc.encode(text);

  if (tokens.length === 0) {
    return [];
  }

  if (tokens.length <= chunkSize) {
    return [
      {
        index: 0,
        text,
        tokenCount: tokens.length,
      },
    ];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < tokens.length) {
    const end = Math.min(start + chunkSize, tokens.length);
    const slice = tokens.slice(start, end);
    chunks.push({
      index,
      text: enc.decode(slice),
      tokenCount: slice.length,
    });
    index += 1;
    if (end >= tokens.length) {
      break;
    }
    start = end - overlap;
  }

  return chunks;
}

export function countTokens(text: string): number {
  return getEncoder().encode(text).length;
}

/**
 * Generate a single embedding vector (1536d via text-embedding-3-small).
 */
export async function generateEmbedding(text: string): Promise<{
  embedding: number[];
  tokens: number;
  costUsd: number;
}> {
  const response = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  const embedding = response.data[0]?.embedding;
  if (!embedding) {
    throw new Error('Embedding response missing vector');
  }

  const tokens = response.usage?.total_tokens ?? countTokens(text);
  return {
    embedding,
    tokens,
    costUsd: calculateCostUsd(EMBEDDING_MODEL, tokens),
  };
}

/**
 * Batch embedding generation (OpenAI accepts arrays of inputs).
 */
export async function generateBatchEmbeddings(texts: string[]): Promise<{
  embeddings: number[][];
  tokens: number;
  costUsd: number;
}> {
  if (texts.length === 0) {
    return { embeddings: [], tokens: 0, costUsd: 0 };
  }

  const response = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  const embeddings = response.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);

  const tokens =
    response.usage?.total_tokens ??
    texts.reduce((sum, text) => sum + countTokens(text), 0);

  return {
    embeddings,
    tokens,
    costUsd: calculateCostUsd(EMBEDDING_MODEL, tokens),
  };
}

/**
 * Chunk text then embed each chunk.
 */
export async function embedDocument(text: string): Promise<
  Array<{
    chunk: TextChunk;
    embedding: number[];
  }>
> {
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return [];
  }

  const { embeddings } = await generateBatchEmbeddings(
    chunks.map((chunk) => chunk.text),
  );

  return chunks.map((chunk, index) => ({
    chunk,
    embedding: embeddings[index] ?? [],
  }));
}
