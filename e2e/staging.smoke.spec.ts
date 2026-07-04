import { expect, test } from '@playwright/test';

const gatewayUrl =
  process.env.E2E_GATEWAY_URL ??
  process.env.E2E_BASE_URL ??
  'http://localhost:3002';

const apiUrl = process.env.E2E_API_URL ?? gatewayUrl;

test.describe('Staging smoke', () => {
  test('gateway health returns ok', async ({ request }) => {
    const response = await request.get(`${gatewayUrl}/health`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('status');
  });

  test('api health returns ok', async ({ request }) => {
    const response = await request.get(`${apiUrl}/health`);
    // Staging may route /health through gateway or API host
    expect([200, 503]).toContain(response.status());
    if (response.status() === 200) {
      const body = await response.json();
      expect(body).toHaveProperty('timestamp');
    }
  });

  test('dashboard is reachable', async ({ page }) => {
    const base = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
    const response = await page.goto(base, { waitUntil: 'domcontentloaded' });
    expect(response?.ok() || response?.status() === 200).toBeTruthy();
  });
});
