# Nova Support — Alert Configuration

Observability stack: **Datadog** (APM + metrics), **Sentry** (errors), **LangSmith** (AI traces), **Pino** (structured logs).

Configure these monitors in Datadog / Sentry / PagerDuty / Slack. Thresholds below are production defaults.

## Alert matrix

| Condition                          | Window     | Severity | Route               | Notes                                              |
| ---------------------------------- | ---------- | -------- | ------------------- | -------------------------------------------------- |
| Error rate **> 1%**                | 5 minutes  | Critical | **PagerDuty**       | HTTP 5xx / total requests for service `nova-api`   |
| P99 latency **> 2s**               | 10 minutes | High     | **Slack `#alerts`** | Datadog APM p99 for `nova-api`                     |
| AI hallucination rate **> 5%**     | 15 minutes | High     | **Email AI team**   | Custom metric / LangSmith eval score               |
| Redis connection failures          | 2 minutes  | Critical | **PagerDuty**       | `redis` integration errors or health `redis: down` |
| Database connection pool **> 80%** | 5 minutes  | Warning  | **Slack `#alerts`** | Postgres pool utilization                          |

## Datadog monitors

### 1. Error rate > 1% (PagerDuty)

```text
sum(last_5m):sum:trace.http.request.errors{service:nova-api}.as_count()
/
sum(last_5m):sum:trace.http.request.hits{service:nova-api}.as_count()
> 0.01
```

- **Notify:** `@pagerduty-nova-oncall`
- **Renotify:** every 30 minutes
- **Priority:** P1

### 2. P99 latency > 2s (Slack)

```text
p99:trace.http.request{service:nova-api} > 2
```

- **Evaluation window:** 10 minutes
- **Notify:** `@slack-alerts`
- **Priority:** P2

### 3. Redis connection failures (PagerDuty)

```text
sum(last_2m):sum:trace.ioredis.command.errors{service:nova-api}.as_count() > 5
```

Or synthetic check against `GET /health` where `redis != "up"`.

- **Notify:** `@pagerduty-nova-oncall`
- **Priority:** P1

### 4. Database pool > 80% (Slack warning)

```text
avg(last_5m):avg:postgresql.connections.utilization{service:nova-api} > 0.8
```

If using Prisma metrics, substitute the pool gauge exported by the API.

- **Notify:** `@slack-alerts`
- **Priority:** P3

## AI hallucination rate > 5% (Email AI team)

Track via LangSmith evaluators or a custom metric:

```text
sum(last_15m):sum:nova.ai.hallucination{service:nova-api}.as_count()
/
sum(last_15m):sum:nova.ai.responses{service:nova-api}.as_count()
> 0.05
```

- **Notify:** `ai-team@your-domain.com`
- **Priority:** P2
- **Source:** LangSmith project `nova-support-production` feedback / eval runs

## Sentry alerts

| Rule                                | Action          |
| ----------------------------------- | --------------- |
| New issue in `nova-api`             | Slack `#alerts` |
| Issue frequency > 50 events / 5 min | PagerDuty       |
| Unhandled exception spike           | PagerDuty       |

Ensure **sendDefaultPii is false** and `beforeSend` redaction remains enabled (see `apps/api/src/lib/observability.ts`).

## Health endpoints

| Path                   | Use                                                        |
| ---------------------- | ---------------------------------------------------------- |
| `GET /health`          | Liveness (Redis + Pinecone)                                |
| `GET /health/detailed` | Datadog / Sentry / LangSmith status + `lastErrorTimestamp` |

Probe `/health/detailed` from uptime checks; alert if `status` is `down`, or if `checks.datadog|sentry|langsmith` is false for > 10 minutes in production.

## Manual test checklist

- [ ] Trigger a 500 and confirm Sentry event (no email/phone in payload)
- [ ] Confirm Datadog APM shows traces for `GET /health`
- [ ] Run an AI call via `traceAiCall` and confirm LangSmith run in `nova-support-production`
- [ ] Force Redis stop → `/health` returns 503 and PagerDuty fires within 2 minutes
- [ ] Load test until p99 > 2s → Slack `#alerts` notification
- [ ] Logs in production are JSON with `trace_id` / `span_id` and redacted secrets

## Environment

```bash
DATADOG_API_KEY=...
DATADOG_APP_KEY=...
SENTRY_DSN=...
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=nova-support-production
```
