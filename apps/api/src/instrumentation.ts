/**
 * Side-effect entrypoint: load before Fastify/Redis/etc. so dd-trace
 * can patch libraries at require-time.
 */
import {
  initObservability,
  registerProcessErrorHandlers,
} from '@/lib/observability';

initObservability();
registerProcessErrorHandlers();
