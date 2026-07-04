import { CarrierAdapter } from './base';
import { buildTrackingResponse, normalizeEvents } from './mapper';
import type { TrackingResponse } from './types';

/**
 * DHL Tracking API.
 * Env: DHL_API_KEY
 */
export class DhlAdapter extends CarrierAdapter {
  readonly name = 'dhl';

  validate(trackingNumber: string): boolean {
    const n = this.normalizeNumber(trackingNumber);
    return (
      /^\d{10,11}$/.test(n) ||
      /^[A-Z]{3}\d{7}$/i.test(n) ||
      /^JD\d{18}$/i.test(n)
    );
  }

  isSupported(_country: string): boolean {
    return true;
  }

  async track(trackingNumber: string): Promise<TrackingResponse> {
    const number = this.normalizeNumber(trackingNumber);
    const apiKey = process.env.DHL_API_KEY;
    if (!apiKey) {
      throw new Error('DHL credentials not configured');
    }

    const response = await fetch(
      `https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(number)}`,
      {
        headers: { 'DHL-API-Key': apiKey, Accept: 'application/json' },
      },
    );

    if (!response.ok) {
      throw new Error(`DHL track failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      shipments?: Array<{
        status?: { statusCode?: string; description?: string };
        estimatedTimeOfDelivery?: string;
        events?: Array<{
          timestamp?: string;
          location?: { address?: { addressLocality?: string } };
          description?: string;
          statusCode?: string;
        }>;
      }>;
    };

    const shipment = payload.shipments?.[0];
    const events = normalizeEvents(
      (shipment?.events ?? []).map((event) => ({
        status: event.statusCode,
        description: event.description,
        timestamp: event.timestamp,
        location: event.location?.address?.addressLocality,
      })),
    );

    if (events.length === 0 && shipment?.status?.description) {
      events.push({
        status: 'unknown',
        description: shipment.status.description,
        timestamp: new Date().toISOString(),
      });
    }

    return buildTrackingResponse({
      carrier: this.name,
      trackingNumber: number,
      events,
      estimatedDelivery: shipment?.estimatedTimeOfDelivery,
      source: 'api',
    });
  }
}
