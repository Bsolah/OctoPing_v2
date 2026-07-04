import {
  Pinecone,
  type Index,
  type RecordMetadata,
} from '@pinecone-database/pinecone';

import { generateEmbedding } from '../embeddings/generator';

export type RetrievedDocument = {
  id: string;
  score: number;
  title: string;
  content: string;
  contentType: string;
  /** Citation metadata for grounding responses */
  source: {
    productId?: string;
    title: string;
    url?: string;
    sourceId?: string;
    contentType: string;
  };
  metadata: Record<string, unknown>;
};

let pineconeIndex: Index<RecordMetadata> | null = null;

function getIndex(): Index<RecordMetadata> {
  if (!pineconeIndex) {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      throw new Error('PINECONE_API_KEY is required for RAG retrieval');
    }
    const indexName = process.env.PINECONE_INDEX_NAME ?? 'nova-support-kb';
    pineconeIndex = new Pinecone({ apiKey }).index(indexName);
  }
  return pineconeIndex;
}

function merchantNamespace(merchantId: string): string {
  return `merchant-${merchantId}`;
}

function normalizeContentType(contentType?: string): string | undefined {
  if (!contentType) {
    return undefined;
  }
  return contentType.toLowerCase();
}

function toDocument(match: {
  id: string;
  score?: number;
  metadata?: RecordMetadata;
}): RetrievedDocument {
  const metadata = (match.metadata ?? {}) as Record<string, unknown>;
  const title = typeof metadata.title === 'string' ? metadata.title : '';
  const content = typeof metadata.content === 'string' ? metadata.content : '';
  const contentType =
    typeof metadata.contentType === 'string' ? metadata.contentType : 'unknown';
  const sourceId =
    typeof metadata.sourceId === 'string' ? metadata.sourceId : match.id;
  const productId =
    typeof metadata.shopifyProductId === 'string'
      ? metadata.shopifyProductId
      : typeof metadata.product_id === 'string'
        ? metadata.product_id
        : typeof metadata.handle === 'string'
          ? metadata.handle
          : undefined;
  const url =
    typeof metadata.url === 'string'
      ? metadata.url
      : typeof metadata.handle === 'string'
        ? `/products/${metadata.handle}`
        : undefined;

  return {
    id: match.id,
    score: match.score ?? 0,
    title,
    content,
    contentType,
    source: {
      productId,
      title,
      url,
      sourceId,
      contentType,
    },
    metadata,
  };
}

/**
 * Embed query, search Pinecone merchant namespace, return scored documents with citations.
 */
export async function retrieveContext(
  merchantId: string,
  query: string,
  topK = 5,
  contentType?: string,
): Promise<RetrievedDocument[]> {
  const { embedding } = await generateEmbedding(query);
  const namespace = merchantNamespace(merchantId);
  const normalizedType = normalizeContentType(contentType);

  const filter = normalizedType
    ? {
        merchantId: { $eq: merchantId },
        contentType: { $eq: normalizedType },
      }
    : {
        merchantId: { $eq: merchantId },
      };

  const response = await getIndex().namespace(namespace).query({
    vector: embedding,
    topK,
    includeMetadata: true,
    filter,
  });

  return (response.matches ?? []).map((match) =>
    toDocument({
      id: match.id,
      score: match.score,
      metadata: match.metadata,
    }),
  );
}

export async function retrieveProductContext(
  merchantId: string,
  query: string,
  topK = 5,
): Promise<RetrievedDocument[]> {
  return retrieveContext(merchantId, query, topK, 'product');
}

export async function retrievePolicyContext(
  merchantId: string,
  query: string,
  topK = 5,
): Promise<RetrievedDocument[]> {
  return retrieveContext(merchantId, query, topK, 'policy');
}
