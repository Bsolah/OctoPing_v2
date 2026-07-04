#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/health-check.sh [base-url]
# Examples:
#   ./scripts/health-check.sh https://staging.nova-support.dev
#   ./scripts/health-check.sh https://nova-support.com

BASE_URL="${1:-http://localhost:3001}"
BASE_URL="${BASE_URL%/}"
TIMEOUT_SECS="${HEALTH_CHECK_TIMEOUT:-10}"
FAIL=0

check() {
  local name="$1"
  local url="$2"
  local code

  echo -n "Checking ${name} (${url})... "

  code="$(
    curl -sS -o /tmp/nova-health-body.json -w "%{http_code}" \
      --max-time "${TIMEOUT_SECS}" \
      -H "Accept: application/json" \
      "${url}" || true
  )"

  if [[ "${code}" == "200" ]]; then
    echo "OK (${code})"
  else
    echo "FAIL (${code:-curl-error})"
    if [[ -f /tmp/nova-health-body.json ]]; then
      head -c 500 /tmp/nova-health-body.json || true
      echo
    fi
    FAIL=1
  fi
}

echo "Nova Support health check — ${BASE_URL}"
echo "----------------------------------------"

# Gateway / edge entrypoints
check "gateway /health" "${BASE_URL}/health"
check "gateway /health (api rewrite)" "${BASE_URL}/api/health"

# Direct API (when base URL is the API host, or override via env)
API_URL="${HEALTH_API_URL:-${BASE_URL}}"
API_URL="${API_URL%/}"
check "api /health" "${API_URL}/health"
check "api /health/detailed" "${API_URL}/health/detailed"

# Dashboard (optional override)
DASHBOARD_URL="${HEALTH_DASHBOARD_URL:-}"
if [[ -n "${DASHBOARD_URL}" ]]; then
  check "dashboard" "${DASHBOARD_URL%/}"
fi

echo "----------------------------------------"
if [[ "${FAIL}" -ne 0 ]]; then
  echo "Health check failed"
  exit 1
fi

echo "All services healthy"
exit 0
