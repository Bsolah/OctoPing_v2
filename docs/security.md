# Nova Support — Security

## Encryption

| Layer                        | Standard                                                           |
| ---------------------------- | ------------------------------------------------------------------ |
| At rest (PII, access tokens) | **AES-256-GCM** (`encryptPII` / `ENCRYPTION_KEY`)                  |
| In transit                   | **TLS 1.3** (Vercel Edge, load balancer, Postgres/Redis providers) |
| Passwords / opaque tokens    | **bcrypt** (cost factor 12) via `hashSensitive`                    |

Application-layer encryption is used for Shopify `accessToken` and other PII columns. Verify ciphertext in Postgres:

```sql
-- Access tokens must not be plaintext Shopify tokens
SELECT id, shop_domain, LEFT("accessToken", 20) AS token_prefix
FROM merchants
LIMIT 5;
-- Expect token_prefix like base64 segments separated by ':', not 'shpat_'
```

## Secrets management

| Environment | Source                                                                         |
| ----------- | ------------------------------------------------------------------------------ |
| Local       | `scripts/setup-secrets.sh` → `apps/*/.env` (gitignored)                        |
| Production  | **AWS Secrets Manager** or **HashiCorp Vault** (`SECRETS_PROVIDER=aws\|vault`) |

- Never commit `.env` files or paste secrets into tickets/logs.
- Pino redacts `password`, `token`, `accessToken`, `secret`, `ENCRYPTION_KEY`, `authorization`, etc.
- Error responses never include stack traces or secret material to clients.

### Annual encryption key rotation

1. Generate a new 32-character key; store as `ENCRYPTION_KEY_NEW` in Secrets Manager/Vault.
2. Deploy code that can decrypt with **both** old and new keys (dual-read).
3. Background job: re-encrypt all `accessToken` / PII fields with the new key.
4. Promote `ENCRYPTION_KEY_NEW` → `ENCRYPTION_KEY`; remove old key after verification.
5. Record rotation date in the security calendar (target: **once per year**, or immediately on suspected compromise).

## HTTP security controls

API (`apps/api/src/middleware/security.ts`):

- Helmet: CSP, HSTS (2y), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`
- CORS allowlist (`SHOPIFY_APP_URL`, `CORS_ALLOWED_ORIGINS`, `*.myshopify.com`)
- Body limit **1MB**, request timeout **30s**
- Auth endpoints: **5 attempts / 15 min** per IP
- Blocks SQL injection / path traversal / `<script>` patterns

Dashboard (Next.js headers): CSP `frame-ancestors` for Shopify Admin embed, referrer policy, nosniff.

Gateway: Shopify webhooks require valid **HMAC-SHA256**; failures return **401** and are logged without the secret.

## GDPR

| Right   | Implementation                                                            |
| ------- | ------------------------------------------------------------------------- |
| Access  | `exportCustomerData(email)` — conversations, messages, orders, agents     |
| Erasure | `deleteCustomerData(email)` — anonymize email/PII, redact message content |

## Incident response

1. **Detect** — Datadog/Sentry alerts, Snyk, anomalous auth rate limits.
2. **Contain** — Rotate compromised secrets; revoke Shopify tokens; enable maintenance mode if needed.
3. **Eradicate** — Patch vulnerability; redeploy from known-good commit (see [rollback.md](./rollback.md)).
4. **Recover** — Restore services; run `./scripts/health-check.sh`.
5. **Lessons** — Postmortem within 5 business days; update runbooks.

Severity routing: P1 (data breach / auth bypass) → PagerDuty page; P2 → Slack `#alerts`.

## Penetration testing

- **Cadence:** quarterly external pen test + annual full-scope assessment.
- Scope: API, gateway, dashboard, Shopify app auth, webhook paths.
- Track findings in the security backlog; critical issues block release.

## Dependency scanning (Snyk)

- PR checks: fail on **critical** vulnerabilities.
- Weekly scheduled scan (`.github/workflows/snyk.yml`).
- `SNYK_TOKEN` stored in GitHub Secrets only.
