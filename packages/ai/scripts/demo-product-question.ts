/**
 * Simple product-question demo.
 *
 * Usage (from packages/ai):
 *   pnpm demo
 *
 * Requires OPENAI_API_KEY. Pinecone vars optional — without them, runs prompt-only.
 */
import { chat } from '../src/llm/client';
import { MODELS } from '../src/llm/models';
import {
  buildSystemPrompt,
  formatContextForLLM,
} from '../src/rag/context-builder';
import { getPreSalePrompt } from '../src/prompts/pre-sale';

async function main() {
  const question =
    process.argv[2] ?? 'What materials is the Classic Tee made from?';

  const shopName = process.env.DEMO_SHOP_NAME ?? 'Nova Demo Store';
  const shopDomain = process.env.DEMO_SHOP_DOMAIN ?? 'nova-demo.myshopify.com';

  let documents: Array<{
    id: string;
    score: number;
    title: string;
    content: string;
    contentType: string;
    source: {
      productId?: string;
      title: string;
      url?: string;
      contentType: string;
    };
    metadata: Record<string, unknown>;
  }> = [];

  if (process.env.PINECONE_API_KEY && process.env.DEMO_MERCHANT_ID) {
    const { retrieveProductContext } = await import('../src/rag/retriever');
    documents = await retrieveProductContext(
      process.env.DEMO_MERCHANT_ID,
      question,
      5,
    );
    console.log(`Retrieved ${documents.length} product documents`);
    for (const doc of documents) {
      console.log(
        `  - ${doc.source.title} (${doc.score.toFixed(3)}) ${doc.source.url ?? ''}`,
      );
    }
  } else {
    // Offline fixture context for local prompt/LLM testing
    documents = [
      {
        id: 'demo-1',
        score: 0.91,
        title: 'Classic Tee',
        content:
          'The Classic Tee is made from 100% organic cotton, 180 GSM, pre-shrunk. Available in S–XXL.',
        contentType: 'product',
        source: {
          productId: 'gid://shopify/Product/1',
          title: 'Classic Tee',
          url: '/products/classic-tee',
          contentType: 'product',
        },
        metadata: {},
      },
    ];
    console.log(
      'Using fixture product context (set PINECONE_API_KEY + DEMO_MERCHANT_ID for live RAG)',
    );
  }

  const prompt = getPreSalePrompt('prompt_v1');
  const systemPrompt = buildSystemPrompt(
    {
      id: 'demo',
      shopName,
      shopDomain,
      tone: 'friendly_professional',
    },
    'friendly_professional',
    ['Never invent inventory counts'],
    prompt.template,
  );

  const messages = formatContextForLLM({
    systemPrompt,
    ragDocuments: documents,
    userMessage: question,
  });

  console.log('\nQuestion:', question);
  console.log('Model:', MODELS.fast.id);
  console.log('---');

  const started = Date.now();
  const result = await chat(messages, MODELS.fast.id, { merchantId: 'demo' });
  console.log(result.content);
  console.log('---');
  console.log(
    `tokens in/out: ${result.usage.inputTokens}/${result.usage.outputTokens} | cost: $${result.costUsd.toFixed(6)} | ${result.latencyMs}ms (total ${Date.now() - started}ms)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
