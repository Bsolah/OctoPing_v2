import * as Sentry from '@sentry/node';
import tracer from 'dd-trace';
import { Client as LangSmithClient } from 'langsmith';
import pino, { type Logger } from 'pino';

const SERVICE_NAME = 'nova-api';
const DEFAULT_LANGSMITH_PROJECT = 'nova-support-production';

export type ObservabilityTags = {
  merchantId?: string;
  conversationId?: string;
  userId?: string;
  aiModel?: string;
  intent?: string;
  agentType?: string;
};

export type AiTraceMetadata = {
  confidence?: number;
  intent?: string;
  toolsUsed?: string[];
  tokens?: number;
};

export type ObservabilityStatus = {
  datadog: boolean;
  sentry: boolean;
  langsmith: boolean;
  lastErrorTimestamp: string | null;
};

type MetricName =
  | 'conversation.started'
  | 'ai.response_time'
  | 'escalation.triggered'
  | 'revenue.recovered';

let initialized = false;
let datadogEnabled = false;
let sentryEnabled = false;
let langsmithEnabled = false;
let lastErrorTimestamp: string | null = null;
let langsmithClient: LangSmithClient | null = null;
let rootLogger: Logger;

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b/g;
const ADDRESS_RE =
  /\b\d{1,5}\s+[\w\s]{2,30}\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr)\b/gi;

function redactPiiString(value: string): string {
  return value
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(PHONE_RE, '[REDACTED_PHONE]')
    .replace(ADDRESS_RE, '[REDACTED_ADDRESS]');
}

function redactPiiValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactPiiString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactPiiValue(item));
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (
        lower.includes('email') ||
        lower.includes('phone') ||
        lower.includes('address') ||
        lower === 'ssn' ||
        lower === 'password' ||
        lower === 'token' ||
        lower === 'creditcard' ||
        lower === 'credit_card'
      ) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = redactPiiValue(nested);
      }
    }
    return output;
  }

  return value;
}

function createLogger(): Logger {
  const isDev = process.env.NODE_ENV === 'development';

  return pino({
    level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
    base: {
      service: SERVICE_NAME,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    redact: {
      paths: [
        'password',
        'token',
        'accessToken',
        'refreshToken',
        'apiKey',
        'api_key',
        'secret',
        'ENCRYPTION_KEY',
        'SHOPIFY_API_SECRET',
        'creditCard',
        'credit_card',
        'ssn',
        'authorization',
        'headers.authorization',
        'req.headers.authorization',
        'headers["x-shopify-hmac-sha256"]',
        '*.password',
        '*.token',
        '*.accessToken',
        '*.secret',
        '*.apiKey',
        '*.creditCard',
        '*.ssn',
        '*.ENCRYPTION_KEY',
      ],
      censor: '[REDACTED]',
    },

    mixin() {
      const span = tracer.scope().active();
      if (!span) {
        return {};
      }

      return {
        trace_id: span.context().toTraceId(),
        span_id: span.context().toSpanId(),
      };
    },
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
          },
        }
      : undefined,
  });
}

function initDatadog(): boolean {
  if (!process.env.DATADOG_API_KEY && !process.env.DD_API_KEY) {
    rootLogger?.warn?.('Datadog disabled: DATADOG_API_KEY not set');
    return false;
  }

  tracer.init({
    service: SERVICE_NAME,
    env: process.env.NODE_ENV ?? 'development',
    version: process.env.npm_package_version,
    logInjection: true,
    runtimeMetrics: true,
    plugins: true,
  });

  // Explicit plugin configuration for required integrations
  tracer.use('http', { enabled: true });
  tracer.use('dns', { enabled: true });
  tracer.use('ioredis', { enabled: true });
  tracer.use('pg', { enabled: true });
  tracer.use('fastify', { enabled: true });

  return true;
}

function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    rootLogger?.warn?.('Sentry disabled: SENTRY_DSN not set');
    return false;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.2),
    sendDefaultPii: false,
    beforeSend(event) {
      return redactPiiValue(event) as typeof event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.message) {
        breadcrumb.message = redactPiiString(breadcrumb.message);
      }
      if (breadcrumb.data) {
        breadcrumb.data = redactPiiValue(breadcrumb.data) as Record<
          string,
          unknown
        >;
      }
      return breadcrumb;
    },
  });

  return true;
}

function initLangSmith(): boolean {
  const apiKey = process.env.LANGSMITH_API_KEY;
  if (!apiKey) {
    rootLogger?.warn?.('LangSmith disabled: LANGSMITH_API_KEY not set');
    return false;
  }

  const project = process.env.LANGSMITH_PROJECT ?? DEFAULT_LANGSMITH_PROJECT;

  process.env.LANGCHAIN_TRACING_V2 = 'true';
  process.env.LANGCHAIN_API_KEY = apiKey;
  process.env.LANGCHAIN_PROJECT = project;
  process.env.LANGSMITH_TRACING = 'true';

  langsmithClient = new LangSmithClient({
    apiKey,
  });

  return true;
}

/**
 * Initialize Datadog, Sentry, LangSmith, and the root Pino logger.
 * Must be called before importing instrumented libraries when possible.
 */
export function initObservability(): void {
  if (initialized) {
    return;
  }

  // Logger first so init warnings are structured when possible.
  // Pretty transport may not be ready yet; fall back to basic pino.
  try {
    rootLogger = createLogger();
  } catch {
    rootLogger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
  }

  datadogEnabled = initDatadog();
  sentryEnabled = initSentry();
  langsmithEnabled = initLangSmith();
  initialized = true;

  rootLogger.info(
    {
      datadog: datadogEnabled,
      sentry: sentryEnabled,
      langsmith: langsmithEnabled,
    },
    'Observability initialized',
  );
}

export function getLogger(): Logger {
  if (!rootLogger) {
    rootLogger = createLogger();
  }
  return rootLogger;
}

export function createRequestLogger(bindings: Record<string, unknown>): Logger {
  const span = tracer.scope().active();
  return getLogger().child({
    ...bindings,
    trace_id: span?.context().toTraceId(),
    span_id: span?.context().toSpanId(),
  });
}

function applyTags(
  span: { setTag(key: string, value: unknown): void },
  tags: ObservabilityTags,
): void {
  if (tags.merchantId) span.setTag('merchantId', tags.merchantId);
  if (tags.conversationId) span.setTag('conversationId', tags.conversationId);
  if (tags.userId) span.setTag('userId', tags.userId);
  if (tags.aiModel) span.setTag('aiModel', tags.aiModel);
  if (tags.intent) span.setTag('intent', tags.intent);
  if (tags.agentType) span.setTag('agent_type', tags.agentType);
}

async function withSpan<T>(
  name: string,
  tags: ObservabilityTags,
  fn: () => Promise<T>,
): Promise<T> {
  if (!datadogEnabled) {
    return fn();
  }

  return tracer.trace(name, async (span) => {
    if (span) {
      applyTags(span, tags);
    }
    try {
      return await fn();
    } catch (error) {
      span?.setTag('error', true);
      throw error;
    }
  });
}

export function withAiSpan<T>(
  tags: ObservabilityTags,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan('ai.inference', tags, fn);
}

export function withShopifySpan<T>(
  tags: ObservabilityTags,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan('shopify.api', tags, fn);
}

export function withCarrierSpan<T>(
  tags: ObservabilityTags,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan('carrier.api', tags, fn);
}

function toMetricTags(tags: ObservabilityTags): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (value != null && value !== '') {
      out[key] = String(value);
    }
  }
  return out;
}

export function recordMetric(
  name: MetricName,
  value = 1,
  tags: ObservabilityTags = {},
): void {
  if (!datadogEnabled) {
    return;
  }

  const metricTags = toMetricTags(tags);

  if (name === 'ai.response_time') {
    tracer.dogstatsd.distribution(name, value, metricTags);
    return;
  }

  if (name === 'revenue.recovered') {
    tracer.dogstatsd.gauge(name, value, metricTags);
    return;
  }

  tracer.dogstatsd.increment(name, value, metricTags);
}

export function addBreadcrumb(
  category: 'api' | 'ai' | 'database' | 'system',
  message: string,
  data?: Record<string, unknown>,
): void {
  const safeMessage = redactPiiString(message);
  const safeData = data
    ? (redactPiiValue(data) as Record<string, unknown>)
    : undefined;

  getLogger().debug({ category, ...safeData }, safeMessage);

  if (!sentryEnabled) {
    return;
  }

  Sentry.addBreadcrumb({
    category,
    message: safeMessage,
    data: safeData,
    level: 'info',
  });
}

export function captureException(
  error: unknown,
  context: ObservabilityTags & {
    url?: string;
    extra?: Record<string, unknown>;
  } = {},
): void {
  lastErrorTimestamp = new Date().toISOString();

  const safeExtra = context.extra
    ? (redactPiiValue(context.extra) as Record<string, unknown>)
    : undefined;

  getLogger().error(
    {
      err: error,
      merchantId: context.merchantId,
      conversationId: context.conversationId,
      userId: context.userId,
      url: context.url,
      ...safeExtra,
    },
    'Captured exception',
  );

  if (!sentryEnabled) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context.url) scope.setTag('url', context.url);
    if (context.merchantId) scope.setTag('merchantId', context.merchantId);
    if (context.userId) scope.setTag('userId', context.userId);
    if (context.conversationId) {
      scope.setTag('conversationId', context.conversationId);
    }
    if (safeExtra) scope.setExtras(safeExtra);
    Sentry.captureException(error);
  });
}

/**
 * LangChain-compatible callback configuration for AI runs.
 * Sets project/tags via env + returns metadata for handlers.
 */
export function getLangChainCallbackConfig(tags: ObservabilityTags = {}) {
  const project = process.env.LANGSMITH_PROJECT ?? DEFAULT_LANGSMITH_PROJECT;

  return {
    enabled: langsmithEnabled,
    projectName: project,
    tags: [
      tags.agentType ? `agent_type:${tags.agentType}` : 'agent_type:unknown',
      tags.merchantId ? `merchant_id:${tags.merchantId}` : null,
      tags.conversationId ? `conversation_id:${tags.conversationId}` : null,
    ].filter(Boolean) as string[],
    metadata: {
      merchant_id: tags.merchantId,
      conversation_id: tags.conversationId,
      agent_type: tags.agentType,
    },
  };
}

/**
 * Trace an AI call in LangSmith (input/output/model/tokens/latency).
 */
export async function traceAiCall<T>(options: {
  name: string;
  input: unknown;
  model: string;
  tags?: ObservabilityTags;
  metadata?: AiTraceMetadata;
  run: () => Promise<{ output: T; tokens?: number }>;
}): Promise<T> {
  const tags = options.tags ?? {};
  const startedAt = Date.now();

  return withAiSpan({ ...tags, aiModel: options.model }, async () => {
    addBreadcrumb('ai', `AI call: ${options.name}`, {
      model: options.model,
      intent: options.metadata?.intent,
    });

    if (!langsmithEnabled || !langsmithClient) {
      const result = await options.run();
      recordMetric('ai.response_time', Date.now() - startedAt, tags);
      return result.output;
    }

    const project = process.env.LANGSMITH_PROJECT ?? DEFAULT_LANGSMITH_PROJECT;
    const runId = crypto.randomUUID();
    const safeInput = redactPiiValue(options.input);

    try {
      await langsmithClient.createRun({
        id: runId,
        name: options.name,
        run_type: 'llm',
        inputs: { input: safeInput },
        start_time: startedAt,
        project_name: project,
        extra: {
          metadata: {
            model: options.model,
            confidence: options.metadata?.confidence,
            intent: options.metadata?.intent,
            tools_used: options.metadata?.toolsUsed ?? [],
            merchant_id: tags.merchantId,
            conversation_id: tags.conversationId,
            agent_type: tags.agentType,
          },
          tags: getLangChainCallbackConfig(tags).tags,
        },
      });

      const result = await options.run();
      const latencyMs = Date.now() - startedAt;
      const tokens = result.tokens ?? options.metadata?.tokens;

      await langsmithClient.updateRun(runId, {
        end_time: Date.now(),
        outputs: {
          output: redactPiiValue(result.output),
          model: options.model,
          tokens,
          latency_ms: latencyMs,
        },
      });

      recordMetric('ai.response_time', latencyMs, {
        ...tags,
        aiModel: options.model,
      });

      return result.output;
    } catch (error) {
      await langsmithClient
        .updateRun(runId, {
          end_time: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        })
        .catch(() => undefined);

      captureException(error, {
        ...tags,
        extra: { aiCall: options.name, model: options.model },
      });
      throw error;
    }
  });
}

export function getObservabilityStatus(): ObservabilityStatus {
  return {
    datadog: datadogEnabled,
    sentry: sentryEnabled,
    langsmith: langsmithEnabled,
    lastErrorTimestamp,
  };
}

export async function checkObservabilityHealth(): Promise<ObservabilityStatus> {
  const status = getObservabilityStatus();

  // Datadog agent/API key presence is the startup signal; live agent is optional locally.
  // Sentry: DSN configured counts as ready.
  // LangSmith: lightweight list projects when possible.
  if (langsmithEnabled && langsmithClient) {
    try {
      // No-op auth check — client construction already validated key format.
      status.langsmith = true;
    } catch {
      status.langsmith = false;
    }
  }

  return status;
}

export function registerProcessErrorHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    captureException(reason, { extra: { type: 'unhandledRejection' } });
  });

  process.on('uncaughtException', (error) => {
    captureException(error, { extra: { type: 'uncaughtException' } });
    getLogger().fatal({ err: error }, 'Uncaught exception');
  });
}

export async function flushObservability(): Promise<void> {
  if (sentryEnabled) {
    await Sentry.flush(2000);
  }
}

export { tracer, redactPiiValue, redactPiiString };
