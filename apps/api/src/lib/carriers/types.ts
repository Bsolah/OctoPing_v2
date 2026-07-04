export type TrackingStatus =
  | 'pre_transit'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'returned'
  | 'unknown';

export type TrackingEvent = {
  status: TrackingStatus;
  location?: string;
  timestamp: string;
  description: string;
};

export type TrackingResponse = {
  carrier: string;
  trackingNumber: string;
  status: TrackingStatus;
  estimatedDelivery?: string;
  events: TrackingEvent[];
  currentLocation?: string;
  source: 'api' | 'scrape' | 'cache';
  trackedAt: string;
};

export type CarrierName =
  | 'ups'
  | 'fedex'
  | 'usps'
  | 'dhl'
  | 'canada_post'
  | 'royal_mail'
  | 'australia_post'
  | 'ontrac'
  | 'amazon'
  | 'evri'
  | 'dpd'
  | 'purolator';

export type CarrierCredentials = Record<string, string | undefined>;
