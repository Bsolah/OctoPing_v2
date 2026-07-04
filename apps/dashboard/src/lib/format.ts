export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatCurrency(
  value: number | string | null | undefined,
): string {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export function statusTone(
  status: string,
): 'success' | 'attention' | 'critical' | 'info' {
  switch (status) {
    case 'resolved':
      return 'success';
    case 'escalated':
      return 'critical';
    case 'active':
      return 'info';
    default:
      return 'attention';
  }
}
