import * as cheerio from 'cheerio';

import { getLogger } from '@/lib/observability';

import { buildTrackingResponse, normalizeEvents } from './mapper';
import type { TrackingResponse } from './types';

type ScrapeConfig = {
  url: (trackingNumber: string) => string;
  parse: ($: cheerio.CheerioAPI, trackingNumber: string) => TrackingResponse;
};

const SCRAPERS: Record<string, ScrapeConfig> = {
  ups: {
    url: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
    parse: ($, n) =>
      parseGenericPage($, n, 'ups', [
        '.timeline-event',
        '[data-testid="tracking-event"]',
        '.ups-progress_step',
      ]),
  },
  fedex: {
    url: (n) =>
      `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
    parse: ($, n) =>
      parseGenericPage($, n, 'fedex', [
        '.shipment-status',
        '.tracking-event',
        '[data-test-id="tracking-event"]',
      ]),
  },
  usps: {
    url: (n) =>
      `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}`,
    parse: ($, n) =>
      parseGenericPage($, n, 'usps', [
        '.tracking-progress-bar-status',
        '.tb-step',
        '.tracking_history',
      ]),
  },
  dhl: {
    url: (n) =>
      `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(n)}`,
    parse: ($, n) =>
      parseGenericPage($, n, 'dhl', [
        '.c-tracking-result--checkpoint',
        '.timeline',
      ]),
  },
  amazon: {
    url: (n) => `https://track.amazon.com/tracking/${encodeURIComponent(n)}`,
    parse: ($, n) =>
      parseGenericPage($, n, 'amazon', ['.tracking-event', '.event-list']),
  },
};

function parseGenericPage(
  $: cheerio.CheerioAPI,
  trackingNumber: string,
  carrier: string,
  selectors: string[],
): TrackingResponse {
  const descriptions: string[] = [];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text.length > 8 && text.length < 300) {
        descriptions.push(text);
      }
    });
    if (descriptions.length > 0) break;
  }

  if (descriptions.length === 0) {
    const title = $('title').text().replace(/\s+/g, ' ').trim();
    if (title) {
      descriptions.push(title);
    }
  }

  if (descriptions.length === 0) {
    throw new Error(`Scrape produced no events for ${carrier}`);
  }

  const events = normalizeEvents(
    descriptions.slice(0, 20).map((description) => ({
      description,
      timestamp: new Date().toISOString(),
    })),
  );

  return buildTrackingResponse({
    carrier,
    trackingNumber,
    events,
    source: 'scrape',
  });
}

/**
 * HTML scrape fallback when carrier APIs are unavailable.
 * Uses cheerio (no headless browser) for lightweight parsing.
 */
export async function scrapeTracking(
  carrier: string,
  trackingNumber: string,
): Promise<TrackingResponse> {
  const scraper = SCRAPERS[carrier];
  if (!scraper) {
    throw new Error(`No scrape fallback for carrier: ${carrier}`);
  }

  const log = getLogger();
  const url = scraper.url(trackingNumber);

  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; NovaSupportBot/1.0; +https://nova-support.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Scrape HTTP ${response.status} for ${carrier}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const result = scraper.parse($, trackingNumber);

  log.info(
    { carrier, trackingNumber, events: result.events.length },
    'Carrier scrape fallback succeeded',
  );

  return result;
}
