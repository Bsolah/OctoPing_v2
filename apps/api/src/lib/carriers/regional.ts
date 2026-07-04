import { CarrierAdapter } from './base';
import { buildTrackingResponse, normalizeEvents } from './mapper';
import type { TrackingResponse } from './types';

type RegionalConfig = {
  name: string;
  pattern: RegExp;
  countries: string[];
  envKey: string;
  trackUrl: (trackingNumber: string, apiKey: string) => string;
  parse: (payload: unknown, trackingNumber: string) => TrackingResponse;
};

function createRegionalAdapter(config: RegionalConfig): CarrierAdapter {
  return new (class extends CarrierAdapter {
    readonly name = config.name;

    validate(trackingNumber: string): boolean {
      return config.pattern.test(this.normalizeNumber(trackingNumber));
    }

    isSupported(country: string): boolean {
      return config.countries.includes(country.toUpperCase());
    }

    async track(trackingNumber: string): Promise<TrackingResponse> {
      const number = this.normalizeNumber(trackingNumber);
      const apiKey = process.env[config.envKey];
      if (!apiKey) {
        throw new Error(`${config.name} credentials not configured`);
      }

      const response = await fetch(config.trackUrl(number, apiKey), {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`${config.name} track failed: ${response.status}`);
      }

      const payload: unknown = await response.json();
      return config.parse(payload, number);
    }
  })();
}

function simpleParse(
  carrier: string,
  trackingNumber: string,
  events: Array<{
    description?: string;
    location?: string;
    timestamp?: string;
  }>,
  estimatedDelivery?: string,
): TrackingResponse {
  return buildTrackingResponse({
    carrier,
    trackingNumber,
    events: normalizeEvents(events),
    estimatedDelivery,
    source: 'api',
  });
}

/** Canada Post */
export const CanadaPostAdapter = createRegionalAdapter({
  name: 'canada_post',
  pattern: /^\d{16}$|^[A-Z]{2}\d{9}[A-Z]{2}$/i,
  countries: ['CA'],
  envKey: 'CANADA_POST_API_KEY',
  trackUrl: (n, key) =>
    `https://soa-gw.canadapost.ca/vis/track/pin/${n}/detail?api_key=${encodeURIComponent(key)}`,
  parse: (payload, n) => {
    const data = payload as {
      events?: Array<{
        eventDescription?: string;
        eventLocation?: string;
        eventDateTime?: string;
      }>;
    };
    return simpleParse(
      'canada_post',
      n,
      (data.events ?? []).map((e) => ({
        description: e.eventDescription,
        location: e.eventLocation,
        timestamp: e.eventDateTime,
      })),
    );
  },
});

/** Royal Mail (UK) */
export const RoyalMailAdapter = createRegionalAdapter({
  name: 'royal_mail',
  pattern: /^[A-Z]{2}\d{9}GB$/i,
  countries: ['GB'],
  envKey: 'ROYAL_MAIL_API_KEY',
  trackUrl: (n, key) =>
    `https://api.royalmail.net/mailpieces/v2/${n}/events?api_key=${encodeURIComponent(key)}`,
  parse: (payload, n) => {
    const data = payload as {
      mailPieces?: {
        events?: Array<{
          eventName?: string;
          locationName?: string;
          eventDateTime?: string;
        }>;
      };
    };
    return simpleParse(
      'royal_mail',
      n,
      (data.mailPieces?.events ?? []).map((e) => ({
        description: e.eventName,
        location: e.locationName,
        timestamp: e.eventDateTime,
      })),
    );
  },
});

/** Australia Post */
export const AustraliaPostAdapter = createRegionalAdapter({
  name: 'australia_post',
  pattern: /^[A-Z]{2}\d{9}AU$/i,
  countries: ['AU'],
  envKey: 'AUSTRALIA_POST_API_KEY',
  trackUrl: (n, key) =>
    `https://digitalapi.auspost.com.au/shipping/v1/track?tracking_ids=${n}&api_key=${encodeURIComponent(key)}`,
  parse: (payload, n) => {
    const data = payload as {
      tracking_results?: Array<{
        trackable_items?: Array<{
          events?: Array<{
            description?: string;
            location?: string;
            date?: string;
          }>;
        }>;
      }>;
    };
    const events =
      data.tracking_results?.[0]?.trackable_items?.[0]?.events ?? [];
    return simpleParse(
      'australia_post',
      n,
      events.map((e) => ({
        description: e.description,
        location: e.location,
        timestamp: e.date,
      })),
    );
  },
});

/** OnTrac */
export const OnTracAdapter = createRegionalAdapter({
  name: 'ontrac',
  pattern: /^[CD]\d{14}$/i,
  countries: ['US'],
  envKey: 'ONTRAC_API_KEY',
  trackUrl: (n, key) =>
    `https://www.ontrac.com/api/track?tn=${n}&key=${encodeURIComponent(key)}`,
  parse: (payload, n) => {
    const data = payload as {
      events?: Array<{
        status?: string;
        city?: string;
        timestamp?: string;
      }>;
    };
    return simpleParse(
      'ontrac',
      n,
      (data.events ?? []).map((e) => ({
        description: e.status,
        location: e.city,
        timestamp: e.timestamp,
      })),
    );
  },
});

/** Amazon Logistics */
export const AmazonAdapter = createRegionalAdapter({
  name: 'amazon',
  pattern: /^TBA\d{12,}$/i,
  countries: ['US', 'CA', 'GB', 'DE', 'JP'],
  envKey: 'AMAZON_TRACKING_API_KEY',
  trackUrl: (n, key) =>
    `https://api.amazon.com/tracking/v1/${n}?api_key=${encodeURIComponent(key)}`,
  parse: (payload, n) => {
    const data = payload as {
      events?: Array<{
        message?: string;
        location?: string;
        eventTime?: string;
      }>;
    };
    return simpleParse(
      'amazon',
      n,
      (data.events ?? []).map((e) => ({
        description: e.message,
        location: e.location,
        timestamp: e.eventTime,
      })),
    );
  },
});

/** Evri (Hermes UK) */
export const EvriAdapter = createRegionalAdapter({
  name: 'evri',
  pattern: /^\d{16}$/,
  countries: ['GB'],
  envKey: 'EVRI_API_KEY',
  trackUrl: (n, key) =>
    `https://api.evri.com/v1/tracking/${n}?api_key=${encodeURIComponent(key)}`,
  parse: (payload, n) => {
    const data = payload as {
      trackingEvents?: Array<{
        eventDescription?: string;
        location?: string;
        dateTime?: string;
      }>;
    };
    return simpleParse(
      'evri',
      n,
      (data.trackingEvents ?? []).map((e) => ({
        description: e.eventDescription,
        location: e.location,
        timestamp: e.dateTime,
      })),
    );
  },
});

/** DPD */
export const DpdAdapter = createRegionalAdapter({
  name: 'dpd',
  pattern: /^\d{14}$|^%[A-Z0-9]+$/i,
  countries: ['GB', 'DE', 'FR', 'NL', 'BE', 'PL'],
  envKey: 'DPD_API_KEY',
  trackUrl: (n, key) =>
    `https://api.dpd.com/v1/track/${n}?api_key=${encodeURIComponent(key)}`,
  parse: (payload, n) => {
    const data = payload as {
      events?: Array<{
        description?: string;
        location?: string;
        date?: string;
      }>;
    };
    return simpleParse(
      'dpd',
      n,
      (data.events ?? []).map((e) => ({
        description: e.description,
        location: e.location,
        timestamp: e.date,
      })),
    );
  },
});

/** Purolator */
export const PurolatorAdapter = createRegionalAdapter({
  name: 'purolator',
  pattern: /^\d{12}$/,
  countries: ['CA', 'US'],
  envKey: 'PUROLATOR_API_KEY',
  trackUrl: (n, key) =>
    `https://api.purolator.com/track/v1/${n}?api_key=${encodeURIComponent(key)}`,
  parse: (payload, n) => {
    const data = payload as {
      scans?: Array<{
        description?: string;
        depot?: string;
        scanDate?: string;
      }>;
    };
    return simpleParse(
      'purolator',
      n,
      (data.scans ?? []).map((e) => ({
        description: e.description,
        location: e.depot,
        timestamp: e.scanDate,
      })),
    );
  },
});
