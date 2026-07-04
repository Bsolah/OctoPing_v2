# GitHub Secrets & Environments

Never commit API keys, tokens, or database URLs. Configure them in GitHub:

**Settings → Secrets and variables → Actions** (repository secrets)  
**Settings → Environments → staging | production** (environment secrets)

## Repository secrets

| Secret                          | Used by                        |
| ------------------------------- | ------------------------------ |
| `CODECOV_TOKEN`                 | Coverage upload                |
| `SNYK_TOKEN`                    | Dependency vulnerability scans |
| `VERCEL_TOKEN`                  | Gateway + dashboard deploys    |
| `VERCEL_ORG_ID`                 | Vercel scope                   |
| `VERCEL_PROJECT_ID_GATEWAY`     | Gateway project                |
| `VERCEL_PROJECT_ID_DASHBOARD`   | Dashboard project              |
| `RAILWAY_TOKEN`                 | API deploys                    |
| `RAILWAY_STAGING_SERVICE_ID`    | Staging API service            |
| `RAILWAY_PRODUCTION_SERVICE_ID` | Production API service         |

## Environment: `staging`

| Secret                 | Description                              |
| ---------------------- | ---------------------------------------- |
| `STAGING_DATABASE_URL` | Postgres URL for `prisma migrate deploy` |

Also configure app runtime secrets on Railway/Vercel staging (Shopify, Pinecone, OpenAI, Redis, Sentry, Datadog, LangSmith, `ENCRYPTION_KEY`).

## Environment: `production`

| Secret                    | Description                            |
| ------------------------- | -------------------------------------- |
| `PRODUCTION_DATABASE_URL` | Postgres URL for production migrations |

Enable **Required reviewers** on the `production` environment so deploys wait for manual approval.

## Public config (committed)

- `.env.staging` — public staging URLs only
- `.env.production` — public production URLs only
