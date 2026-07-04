export interface KnowledgeBaseEntry {
  id: string;
  merchantId: string;
  contentType: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  score: number;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface PineconeVectorMetadata {
  merchantId: string;
  contentType: string;
  title: string;
  sourceId: string;
  content?: string;
  [key: string]: unknown;
}
