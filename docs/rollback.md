# Nova Support — Rollback Procedure

Target: restore a known-good release in **under 5 minutes**.

All production deploys require approval via the GitHub **production** environment. Staging auto-deploys from `main`.

## When to roll back

- Elevated error rate or P99 latency (see [alerts.md](./alerts.md))
- Failed smoke / health checks after deploy
- Bad migration or data-path regression

## 1. API (Railway or AWS ECS) — ~1–2 min

### Railway

```bash
# List recent deployments
railway deployments --service nova-api --environment production

# Redeploy previous successful deployment
railway rollback --service nova-api --environment production
```

Or in the Railway dashboard: **Service → Deployments → ⋮ → Rollback**.

### AWS ECS

```bash
CLUSTER=nova-production
SERVICE=nova-api

# Previous task definition (example: nova-api:41 → nova-api:40)
PREV_TASK_DEF=nova-api:40

aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --task-definition "$PREV_TASK_DEF" \
  --force-new-deployment

aws ecs wait services-stable \
  --cluster "$CLUSTER" \
  --services "$SERVICE"
```

## 2. Gateway & Dashboard (Vercel) — ~1 min

```bash
# Instant rollback to previous production deployment
vercel rollback --token "$VERCEL_TOKEN" --yes

# Or pin a specific deployment URL
vercel rollback https://nova-gateway-xxxxx.vercel.app --token "$VERCEL_TOKEN" --yes
```

Do this for **both** projects:

- Gateway (`VERCEL_PROJECT_ID_GATEWAY`)
- Dashboard (`VERCEL_PROJECT_ID_DASHBOARD`)

Dashboard: Vercel → Project → Deployments → previous **Ready** → **Promote to Production**.

## 3. Database (Prisma) — ~1–2 min

Migrations are forward-only in normal deploys (`prisma migrate deploy`). To recover:

### Mark a failed migration as rolled back

```bash
cd apps/api
export DATABASE_URL="$PRODUCTION_DATABASE_URL"

# If migrate deploy failed mid-way:
pnpm exec prisma migrate resolve --rolled-back "MIGRATION_NAME"
```

### Restore schema from previous migration

1. Restore DB from the latest snapshot / PITR (RDS, Neon, Supabase, etc.).
2. Align Prisma history:

```bash
pnpm exec prisma migrate resolve --applied "LAST_GOOD_MIGRATION"
```

3. Redeploy the API commit that matches that schema.

**Never** run destructive `migrate reset` in production.

## 4. Verify

```bash
./scripts/health-check.sh https://nova-support.com
```

Expect HTTP 200 from gateway and API health endpoints.

Optional:

```bash
curl -s https://nova-support.com/health/detailed | jq
```

## 5. Communicate

1. Post in `#alerts` / incident channel: version rolled back + reason.
2. Open a follow-up issue with failing commit SHA and monitor links.
3. Re-run CI on a fix branch; do **not** re-promote until E2E passes on staging.

## GitHub Environments

| Environment  | Deploy trigger    | Protection                               |
| ------------ | ----------------- | ---------------------------------------- |
| `staging`    | Push to `main`    | None (auto)                              |
| `production` | After staging E2E | **Required reviewers** (manual approval) |

Configure production protection under **Settings → Environments → production → Required reviewers**.

## Secrets (never commit)

Store in GitHub **Secrets** / environment secrets only:

- `STAGING_DATABASE_URL`, `PRODUCTION_DATABASE_URL`
- `RAILWAY_TOKEN`, `RAILWAY_STAGING_SERVICE_ID`, `RAILWAY_PRODUCTION_SERVICE_ID`
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_GATEWAY`, `VERCEL_PROJECT_ID_DASHBOARD`
- `CODECOV_TOKEN`
- App keys: `SHOPIFY_API_SECRET`, `PINECONE_API_KEY`, `OPENAI_API_KEY`, `SENTRY_DSN`, `DATADOG_API_KEY`, `LANGSMITH_API_KEY`, `ENCRYPTION_KEY`, etc.

Public URLs only belong in `.env.staging` / `.env.production`.
