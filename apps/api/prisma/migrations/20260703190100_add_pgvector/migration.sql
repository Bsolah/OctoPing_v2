-- Enable pgvector extension for knowledge base embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column for vector similarity search
ALTER TABLE "knowledge_base" ADD COLUMN "embedding" vector(3072);
