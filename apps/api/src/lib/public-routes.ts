export function isPublicApiPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';

  return (
    path === '/health' ||
    path.startsWith('/health/') ||
    path.startsWith('/api/shopify/') ||
    path.startsWith('/api/webhooks/shopify/')
  );
}
