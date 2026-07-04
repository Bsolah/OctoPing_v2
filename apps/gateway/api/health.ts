import { isApiHealthy } from '../src/lib/proxy';
import { isRedisHealthy } from '../src/lib/redis';
import { withGateway } from '../src/lib/withGateway';

export const config = {
  runtime: 'edge',
  regions: ['iad1', 'sfo1', 'cdg1', 'hnd1', 'syd1'],
  maxDuration: 30,
};

async function healthHandler(_request: Request) {
  const [redis, api] = await Promise.all([isRedisHealthy(), isApiHealthy()]);
  const status = redis && api ? 'ok' : 'degraded';

  return new Response(
    JSON.stringify({
      status,
      region: process.env.VERCEL_REGION ?? 'unknown',
      timestamp: new Date().toISOString(),
      checks: {
        redis,
        api,
      },
    }),
    {
      status: status === 'ok' ? 200 : 503,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export default withGateway(healthHandler);
