type BreakerState = {
  failures: number;
  openedAt: number | null;
};

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 5 * 60 * 1000;

const breakers = new Map<string, BreakerState>();

export function isCarrierAvailable(carrier: string): boolean {
  const state = breakers.get(carrier);
  if (!state?.openedAt) {
    return true;
  }
  if (Date.now() - state.openedAt >= COOLDOWN_MS) {
    breakers.set(carrier, { failures: 0, openedAt: null });
    return true;
  }
  return false;
}

export function recordCarrierSuccess(carrier: string): void {
  breakers.set(carrier, { failures: 0, openedAt: null });
}

export function recordCarrierFailure(carrier: string): void {
  const state = breakers.get(carrier) ?? { failures: 0, openedAt: null };
  const failures = state.failures + 1;
  breakers.set(carrier, {
    failures,
    openedAt: failures >= FAILURE_THRESHOLD ? Date.now() : state.openedAt,
  });
}

export function getCarrierBreakerState(carrier: string): BreakerState {
  return breakers.get(carrier) ?? { failures: 0, openedAt: null };
}
