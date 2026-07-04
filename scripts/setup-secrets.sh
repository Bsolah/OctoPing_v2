#!/usr/bin/env bash
set -euo pipefail

# Local development secrets bootstrap.
# Production secrets must come from AWS Secrets Manager or HashiCorp Vault —
# never commit real credentials.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_ENV="${ROOT_DIR}/apps/api/.env"
API_EXAMPLE="${ROOT_DIR}/apps/api/.env.example"
GATEWAY_ENV="${ROOT_DIR}/apps/gateway/.env"
GATEWAY_EXAMPLE="${ROOT_DIR}/apps/gateway/.env.example"
DASHBOARD_ENV="${ROOT_DIR}/apps/dashboard/.env"
DASHBOARD_EXAMPLE="${ROOT_DIR}/apps/dashboard/.env.example"

generate_key() {
  # 32-char key for AES-256-GCM ENCRYPTION_KEY
  openssl rand -base64 24 | tr -d '\n' | cut -c1-32
}

copy_if_missing() {
  local src="$1"
  local dest="$2"
  if [[ -f "${dest}" ]]; then
    echo "Keeping existing ${dest}"
  else
    cp "${src}" "${dest}"
    echo "Created ${dest}"
  fi
}

echo "Nova Support — local secrets setup"
echo "----------------------------------"

copy_if_missing "${API_EXAMPLE}" "${API_ENV}"
copy_if_missing "${GATEWAY_EXAMPLE}" "${GATEWAY_ENV}"
copy_if_missing "${DASHBOARD_EXAMPLE}" "${DASHBOARD_ENV}"

NEW_KEY="$(generate_key)"

if grep -q '^ENCRYPTION_KEY=$' "${API_ENV}" 2>/dev/null || \
   grep -q '^ENCRYPTION_KEY=nova_support_dev_encryption_key1$' "${API_ENV}" 2>/dev/null; then
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${NEW_KEY}|" "${API_ENV}"
  else
    sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${NEW_KEY}|" "${API_ENV}"
  fi
  echo "Generated ENCRYPTION_KEY in apps/api/.env"
else
  echo "ENCRYPTION_KEY already set — not rotating automatically"
fi

echo
echo "Next steps:"
echo "  1. Fill remaining values in apps/api/.env, apps/gateway/.env, apps/dashboard/.env"
echo "  2. For production, load secrets via AWS Secrets Manager or Vault (see docs/security.md)"
echo "  3. Never commit .env files"
echo
echo "Done."
