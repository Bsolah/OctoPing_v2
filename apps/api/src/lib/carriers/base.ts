import type { TrackingResponse } from './types';

export abstract class CarrierAdapter {
  abstract readonly name: string;

  /** Fetch live tracking for a number. */
  abstract track(trackingNumber: string): Promise<TrackingResponse>;

  /** Validate tracking number format for this carrier. */
  abstract validate(trackingNumber: string): boolean;

  /** Whether this carrier operates in the given ISO country code. */
  abstract isSupported(country: string): boolean;

  protected normalizeNumber(trackingNumber: string): string {
    return trackingNumber.replace(/\s+/g, '').toUpperCase();
  }
}
