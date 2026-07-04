import { CarrierAdapter } from './base';
import { buildTrackingResponse, normalizeEvents } from './mapper';
import type { TrackingResponse } from './types';

/**
 * FedEx Tracking API (OAuth client credentials).
 * Env: FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET
 */
export class FedexAdapter extends CarrierAdapter {
  readonly name = 'fedex';

  private token: { value: string; expiresAt: number } | null = null;

  validate(trackingNumber: string): boolean {
    const n = this.normalizeNumber(trackingNumber);
    return /^\d{12}$/.test(n) || /^\d{15}$/.test(n) || /^\d{20,22}$/.test(n);
  }

  isSupported(country: string): boolean {
    return ['US', 'CA', 'MX', 'GB', 'DE', 'FR', 'AU', 'CN', 'IN'].includes(
      country.toUpperCase(),
    );
  }

  private async getAccessToken(): Promise<string> {
    const clientId = process.env.FEDEX_CLIENT_ID;
    const clientSecret = process.env.FEDEX_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('FedEx credentials not configured');
    }

    if (this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.value;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await fetch('https://apis.fedex.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      throw new Error(`FedEx OAuth failed: ${response.status}`);
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
      'https://apis.fedex.com/track/v1/trackingnumbers',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          includeDetailedScans: true,
          trackingInfo: [{ trackingNumberInfo: { trackingNumber: number } }],
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`FedEx track failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      output?: {
        completeTrackResults?: Array<{
          trackResults?: Array<{
            scanEvents?: Array<{
              eventDescription?: string;
              date?: string;
              scanLocation?: {
                city?: string;
                stateOrProvinceCode?: string;
                countryCode?: string;
              };
            }>;
            estimatedDeliveryTimeWindow?: { window?: { begins?: string } };
          }>;
        }>;
      };
    };

    const result = payload.output?.completeTrackResults?.[0]?.trackResults?.[0];
    const scans = result?.scanEvents ?? [];

    const events = normalizeEvents(
      scans.map((scan) => ({
        description: scan.eventDescription,
        timestamp: scan.date,
        location: [
          scan.scanLocation?.city,
          scan.scanLocation?.stateOrProvinceCode,
          scan.scanLocation?.countryCode,
        ]
          .filter(Boolean)
          .join(', '),
      })),
    );

    return buildTrackingResponse({
      carrier: this.name,
      trackingNumber: number,
      events,
      estimatedDelivery: result?.estimatedDeliveryTimeWindow?.window?.begins,
      source: 'api',
    });
  }
}
