import {
  HANDLED_WEBHOOK_TOPICS,
  MAX_BODY_BYTES,
  WEBHOOK_STREAM_KEY,
} from '../../src/lib/config';
import { getRedis } from '../../src/lib/redis';
import { errorResponse, readBodyWithLimit } from '../../src/lib/request';
import { verifyShopifyWebhookHmac } from '../../src/lib/shopify';
import { withGateway } from '../../src/lib/withGateway';

export const config = {
  runtime: 'edge',
  regions: ['iad1', 'sfo1', 'cdg1', 'hnd1', 'syd1'],
  maxDuration: 30,
};

async function shopifyWebhookHandler(
  request: Request,
  context: { requestId: string },
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse(405, 'Method not allowed', {
      requestId: context.requestId,
    });
  }

  const bodyResult = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const hmac = request.headers.get('x-shopify-hmac-sha256');
  const shopDomain = request.headers.get('x-shopify-shop-domain') ?? '';
  const topic = request.headers.get('x-shopify-topic') ?? '';
  const valid = await verifyShopifyWebhookHmac(bodyResult.body, hmac);

  // Log verification attempts without the secret or full HMAC
  console.log(
    JSON.stringify({
      msg: 'shopify_webhook_hmac_verification',
      requestId: context.requestId,
      shopDomain,
      topic,
      hasSignature: Boolean(hmac),
      valid,
    }),
  );

  if (!valid) {
    return errorResponse(401, 'Invalid webhook signature', {
      requestId: context.requestId,
    });
  }

  if (!HANDLED_WEBHOOK_TOPICS.has(topic)) {
    return new Response(JSON.stringify({ ok: true, queued: false }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': context.requestId,
      },
    });
  }

  const payloadText = new TextDecoder().decode(bodyResult.body);

  await getRedis().xadd(WEBHOOK_STREAM_KEY, '*', {
    topic,
    shopDomain,
    payload: payloadText,
    requestId: context.requestId,
    receivedAt: new Date().toISOString(),
  });

  return new Response(JSON.stringify({ ok: true, queued: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': context.requestId,
    },
  });
}

export default withGateway(shopifyWebhookHandler);
