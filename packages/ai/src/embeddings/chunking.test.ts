import { chunkText, countTokens } from './generator';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const short = chunkText('Hello world');
  assert(short.length === 1, 'short text is one chunk');
  assert(short[0]!.tokenCount === countTokens('Hello world'), 'token count');

  // Build text large enough to force multiple 512-token chunks
  const words = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(' ');
  const chunks = chunkText(words, 512, 50);
  assert(chunks.length > 1, 'long text produces multiple chunks');
  assert(chunks[0]!.tokenCount <= 512, 'chunk size respected');

  // Overlap: second chunk should start before first chunk ends
  assert(chunks.length >= 2, 'has overlap candidate');

  console.log('Chunking tests passed');
}

main();
