import { CarrierAdapter } from './base';
import { buildTrackingResponse, normalizeEvents } from './mapper';
import type { TrackingResponse } from './types';

/**
 * USPS Tracking API.
 * Env: USPS_USER_ID (Web Tools) or USPS_CLIENT_ID / USPS_CLIENT_SECRET (OAuth)
 */
export class UspsAdapter extends CarrierAdapter {
  readonly name = 'usps';

  validate(trackingNumber: string): boolean {
    const n = this.normalizeNumber(trackingNumber);
    return (
      /^9\d{15,21}$/.test(n) ||
      /^[A-Z]{2}\d{9}[A-Z]{2}$/i.test(n) ||
      /^\d{20,22}$/.test(n)
    );
  }

  isSupported(country: string): boolean {
    return country.toUpperCase() === 'US';
  }

  async track(trackingNumber: string): Promise<TrackingResponse> {
    const number = this.normalizeNumber(trackingNumber);
    const userId = process.env.USPS_USER_ID;
    if (!userId) {
      throw new Error('USPS credentials not configured');
    }

    const xml = `<TrackFieldRequest USERID="${userId}"><TrackID ID="${number}"/></TrackFieldRequest>`;
    const url = `https://secure.shippingapis.com/ShippingAPI.dll?API=TrackV2&XML=${encodeURIComponent(xml)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`USPS track failed: ${response.status}`);
    }

    const text = await response.text();
    const events = normalizeEvents(parseUspsXml(text));

    return buildTrackingResponse({
      carrier: this.name,
      trackingNumber: number,
      events,
      source: 'api',
    });
  }
}

function parseUspsXml(xml: string): Array<{
  description?: string;
  location?: string;
  timestamp?: string;
}> {
  const events: Array<{
    description?: string;
    location?: string;
    timestamp?: string;
  }> = [];

  const detailRegex = /<TrackDetail>([\s\S]*?)<\/TrackDetail>/g;
  let match = detailRegex.exec(xml);
  while (match) {
    const block = match[1] ?? '';
    const event = block.match(/<Event>([^<]*)<\/Event>/)?.[1];
    const city = block.match(/<EventCity>([^<]*)<\/EventCity>/)?.[1];
    const state = block.match(/<EventState>([^<]*)<\/EventState>/)?.[1];
    const date = block.match(/<EventDate>([^<]*)<\/EventDate>/)?.[1];
    const time = block.match(/<EventTime>([^<]*)<\/EventTime>/)?.[1];
    events.push({
      description: event,
      location: [city, state].filter(Boolean).join(', '),
      timestamp:
        date && time ? new Date(`${date} ${time}`).toISOString() : date,
    });
    match = detailRegex.exec(xml);
  }

  const summary = xml.match(/<StatusSummary>([^<]*)<\/StatusSummary>/)?.[1];
  if (summary && events.length === 0) {
    events.push({ description: summary, timestamp: new Date().toISOString() });
  }

  return events;
}
