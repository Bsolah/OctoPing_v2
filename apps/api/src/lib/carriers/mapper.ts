import type { TrackingEvent, TrackingResponse, TrackingStatus } from './types';

const STATUS_MAP: Array<{ pattern: RegExp; status: TrackingStatus }> = [
  { pattern: /delivered|delivery completed|pod/i, status: 'delivered' },
  {
    pattern: /out for delivery|on vehicle|with driver/i,
    status: 'out_for_delivery',
  },
  {
    pattern: /in transit|departed|arrived|facility|sorted|processed/i,
    status: 'in_transit',
  },
  {
    pattern: /label created|info received|pre-?transit|shipment ready/i,
    status: 'pre_transit',
  },
  {
    pattern: /exception|delay|failed|held|customs|undeliverable/i,
    status: 'exception',
  },
  { pattern: /return|returned to sender/i, status: 'returned' },
];

export function mapStatusText(text: string): TrackingStatus {
  for (const entry of STATUS_MAP) {
    if (entry.pattern.test(text)) {
      return entry.status;
    }
  }
  return 'unknown';
}

export function normalizeEvents(
  events: Array<{
    status?: string;
    location?: string;
    timestamp?: string | Date;
    description?: string;
  }>,
): TrackingEvent[] {
  return events
    .map((event) => {
      const description = event.description ?? event.status ?? 'Update';
      const timestamp =
        event.timestamp instanceof Date
          ? event.timestamp.toISOString()
          : (event.timestamp ?? new Date().toISOString());

      return {
        status: mapStatusText(`${event.status ?? ''} ${description}`),
        location: event.location,
        timestamp,
        description,
      };
    })
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
}

export function buildTrackingResponse(input: {
  carrier: string;
  trackingNumber: string;
  events: TrackingEvent[];
  estimatedDelivery?: string;
  source: TrackingResponse['source'];
}): TrackingResponse {
  const latest = input.events[0];
  return {
    carrier: input.carrier,
    trackingNumber: input.trackingNumber,
    status: latest?.status ?? 'unknown',
    estimatedDelivery: input.estimatedDelivery,
    events: input.events,
    currentLocation: latest?.location,
    source: input.source,
    trackedAt: new Date().toISOString(),
  };
}
