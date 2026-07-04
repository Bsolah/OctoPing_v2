/**
 * Demo: run one multi-agent turn (requires OPENAI_API_KEY + REDIS_URL).
 *
 *   pnpm demo:agent
 *   pnpm demo:agent "Where is my order?"
 */
import {
  disconnectAgentStateStore,
  processAgentTurn,
  setEscalationNotifier,
} from '../src/agents';

async function main() {
  const message = process.argv[2] ?? 'Do you have the Classic Tee in medium?';

  setEscalationNotifier(async (payload) => {
    console.log(
      '[notify]',
      payload.conversationId,
      payload.escalationPackage.transcriptSummary,
    );
  });

  const result = await processAgentTurn({
    conversationId: `demo-convo-${Date.now()}`,
    merchantId: process.env.DEMO_MERCHANT_ID ?? 'demo-merchant',
    shopName: process.env.DEMO_SHOP_NAME ?? 'Nova Demo Store',
    shopDomain: process.env.DEMO_SHOP_DOMAIN ?? 'nova-demo.myshopify.com',
    message,
    tone: 'friendly_professional',
    rules: ['Never invent tracking numbers'],
    customerContext: {
      conversationId: 'demo',
      merchantId: 'demo-merchant',
      customer: { email: 'customer@example.com' },
      orders: [
        {
          id: '1001',
          status: 'in_transit',
          trackingNumbers: ['1Z999'],
          carrier: 'UPS',
          createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        },
      ],
      cart: null,
      pastConversations: [],
      recentMessages: [],
    },
  });

  console.log('Intent:', result.intent);
  console.log('Sentiment:', result.sentiment);
  console.log('Confidence:', result.confidence);
  console.log('Tools:', result.toolsCalled.join(', ') || '(none)');
  console.log('Actions:', JSON.stringify(result.actions, null, 2));
  console.log('---');
  console.log(result.response);

  await disconnectAgentStateStore();
}

main().catch(async (error) => {
  console.error(error);
  await disconnectAgentStateStore().catch(() => undefined);
  process.exit(1);
});
