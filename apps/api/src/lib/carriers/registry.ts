import { getLogger } from '@/lib/observability';
import { get, set } from '@/lib/redis';

import { CarrierAdapter } from './base';
import {
  isCarrierAvailable,
  recordCarrierFailure,
  recordCarrierSuccess,
} from './circuit-breaker';
import { DhlAdapter } from './dhl';
import { scrapeTracking } from './fallback';
import { FedexAdapter } from './fedex';
import {
  AmazonAdapter,
  AustraliaPostAdapter,
  CanadaPostAdapter,
  DpdAdapter,
  EvriAdapter,
  OnTracAdapter,
  PurolatorAdapter,
  RoyalMailAdapter,
} from './regional';
import type { TrackingResponse } from './types';
import { UpsAdapter } from './ups';
import { UspsAdapter } from './usps';

const CACHE_TTL_SECONDS = 5 * 60;

const carriers = new Map<string, CarrierAdapter>();

const DETECTION_PATTERNS: Array<{ carrier: string; pattern: RegExp }> = [
  { carrier: 'ups', pattern: /^1Z[A-Z0-9]{16}$/i },
  { carrier: 'usps', pattern: /^9\d{15,21}$|^[A-Z]{2}\d{9}US$/i },
  { carrier: 'amazon', pattern: /^TBA\d{12,}$/i },
  { carrier: 'dhl', pattern: /^(JD\d{18}|\d{10,11})$/i },

  { carrier: 'fedex', pattern: /^\d{12}$|^\d{15}$|^\d{20,22}$/ },

  { carrier: 'royal_mail', pattern: /^[A-Z]{2}\d{9}GB$/i },

  { carrier: 'australia_post', pattern: /^[A-Z]{2}\d{9}AU$/i },
  { carrier: 'canada_post', pattern: /^[A-Z]{2}\d{9}CA$/i },
  { carrier: 'ontrac', pattern: /^[CD]\d{14}$/i },
  { carrier: 'evri', pattern: /^\d{16}$/ },
  { carrier: 'dpd', pattern: /^\d{14}$/ },
  { carrier: 'purolator', pattern: /^\d{12}$/ },
];

export function registerCarrier(name: string, adapter: CarrierAdapter): void {
  carriers.set(name.toLowerCase(), adapter);
}

export function listCarriers(): string[] {
  return [...carriers.keys()];
}

export function detectCarrier(trackingNumber: string): string | null {
  const normalized = trackingNumber.replace(/\s+/g, '').toUpperCase();
  for (const entry of DETECTION_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      return entry.carrier;
    }
  }

  for (const [name, adapter] of carriers) {
    if (adapter.validate(normalized)) {
      return name;
    }
  }

  return null;
}

function cacheKey(trackingNumber: string, carrier: string): string {
  return `tracking:${carrier}:${trackingNumber.toUpperCase()}`;
}

async function trackWithAdapter(
  adapter: CarrierAdapter,
  trackingNumber: string,
): Promise<TrackingResponse> {
  const name = adapter.name;

  if (!isCarrierAvailable(name)) {
    throw new Error(`Carrier circuit open: ${name}`);
  }

  try {
    const result = await adapter.track(trackingNumber);
    recordCarrierSuccess(name);
    return result;
  } catch (apiError) {
    recordCarrierFailure(name);
    getLogger().warn(
      {
        carrier: name,
        err: apiError instanceof Error ? apiError.message : String(apiError),
      },
      'Carrier API failed, trying scrape fallback',
    );

    try {
      const scraped = await scrapeTracking(name, trackingNumber);
      recordCarrierSuccess(name);
      return scraped;
    } catch (scrapeError) {
      recordCarrierFailure(name);
      throw scrapeError instanceof Error ? scrapeError : apiError;
    }
  }
}

/**
 * Track a shipment. Uses carrier hint when provided, otherwise auto-detects.
 * Falls back to trying all carriers when detection fails.
 */
export async function trackShipment(
  trackingNumber: string,
  carrierHint?: string | null,
): Promise<TrackingResponse> {
  const number = trackingNumber.replace(/\s+/g, '').toUpperCase();
  const log = getLogger();

  const preferred =
    carrierHint?.toLowerCase().replace(/\s+/g, '_') ?? detectCarrier(number);

  if (preferred) {
    const cached = await get<TrackingResponse>(cacheKey(number, preferred));
    if (cached) {
      return { ...cached, source: 'cache' };
    }

    const adapter = carriers.get(preferred);
    if (adapter) {
      const result = await trackWithAdapter(adapter, number);
      await set(cacheKey(number, preferred), result, CACHE_TTL_SECONDS);
      return result;
    }
  }

  // Try all carriers that validate the number
  const candidates = [...carriers.values()].filter((adapter) =>
    adapter.validate(number),
  );

  const errors: string[] = [];
  for (const adapter of candidates.length > 0
    ? candidates
    : [...carriers.values()]) {
    if (!isCarrierAvailable(adapter.name)) {
      continue;
    }

    const cached = await get<TrackingResponse>(cacheKey(number, adapter.name));
    if (cached) {
      return { ...cached, source: 'cache' };
    }

    try {
      const result = await trackWithAdapter(adapter, number);
      await set(cacheKey(number, adapter.name), result, CACHE_TTL_SECONDS);
      return result;
    } catch (error) {
      errors.push(
        `${adapter.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  log.error({ trackingNumber: number, errors }, 'All carrier lookups failed');
  throw new Error(
    `Unable to track shipment ${number}. Tried: ${errors.join('; ') || 'no carriers'}`,
  );
}

export function bootstrapCarriers(): void {
  if (carriers.size > 0) {
    return;
  }

  const adapters: CarrierAdapter[] = [
    new UpsAdapter(),
    new FedexAdapter(),
    new UspsAdapter(),
    new DhlAdapter(),
    CanadaPostAdapter,
    RoyalMailAdapter,
    AustraliaPostAdapter,
    OnTracAdapter,
    AmazonAdapter,
    EvriAdapter,
    DpdAdapter,
    PurolatorAdapter,
  ];

  for (const adapter of adapters) {
    registerCarrier(adapter.name, adapter);
  }

  getLogger().info(
    { carriers: listCarriers() },
    'Carrier registry initialized',
  );
}

// Auto-register on import
bootstrapCarriers();
