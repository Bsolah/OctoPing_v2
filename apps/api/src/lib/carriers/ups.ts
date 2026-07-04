import { CarrierAdapter } from './base';
import { buildTrackingResponse, normalizeEvents } from './mapper';
import type { TrackingResponse } from './types';

/**
 * UPS Tracking API (OAuth 2.0 client credentials).
 * Env: UPS_CLIENT_ID, UPS_CLIENT_SECRET, UPS_ACCOUNT_NUMBER (optional)
 */
export class UpsAdapter extends CarrierAdapter {
  readonly name = 'ups';

  private token: { value: string; expiresAt: number } | null = null;

  validate(trackingNumber: string): boolean {
    const n = this.normalizeNumber(trackingNumber);
    return /^1Z[A-Z0-9]{16}$/i.test(n) || /^T\d{10}$/i.test(n);
  }

  isSupported(country: string): boolean {
    return ['US', 'CA', 'MX', 'GB', 'DE', 'FR', 'AU', 'JP'].includes(
      country.toUpperCase(),
    );
  }

  private async getAccessToken(): Promise<string> {
    const clientId = process.env.UPS_CLIENT_ID;
    const clientSecret = process.env.UPS_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('UPS credentials not configured');
    }

    if (this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.value;
    }

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch(
      'https://onlinetools.ups.com/security/v1/oauth/token',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      },
    );

    if (!response.ok) {
      throw new Error(`UPS OAuth failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return this.token.value;
  }

  async track(trackingNumber: string): Promise<TrackingResponse> {
    const number = this.normalizeNumber(trackingNumber);
    const accessToken = await this.getAccessToken();

    const response = await fetch(
      `https://onlinetools.ups.com/api/track/v1/details/${encodeURIComponent(number)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          transId: crypto.randomUUID(),
          transactionSrc: 'nova-support',
        },
      },
    );

    if (!response.ok) {
      throw new Error(`UPS track failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      trackResponse?: {
        shipment?: Array<{
          package?: Array<{
            activity?: Array<{
              status?: { description?: string; type?: string };
              location?: {
                address?: {
                  city?: string;
                  stateProvince?: string;
                  country?: string;
                };
              };
              date?: string;
              time?: string;
            }>;
            deliveryDate?: Array<{ date?: string }>;
          }>;
        }>;
      };
    };

    const pkg = payload.trackResponse?.shipment?.[0]?.package?.[0];
    const activities = pkg?.activity ?? [];

    const events = normalizeEvents(
      activities.map((activity) => {
        const address = activity.location?.address;
        const location = [
          address?.city,
          address?.stateProvince,
          address?.country,
        ]
          .filter(Boolean)
          .join(', ');
        const date = activity.date ?? '';
        const time = activity.time ?? '000000';
        const iso = date
          ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`
          : new Date().toISOString();

        return {
          status: activity.status?.type,
          description: activity.status?.description,
          location,
          timestamp: iso,
        };
      }),
    );

    const eta = pkg?.deliveryDate?.[0]?.date;
    const estimatedDelivery = eta
      ? `${eta.slice(0, 4)}-${eta.slice(4, 6)}-${eta.slice(6, 8)}`
      : undefined;

    return buildTrackingResponse({
      carrier: this.name,
      trackingNumber: number,
      events,
      estimatedDelivery,
      source: 'api',
    });
  }
}
