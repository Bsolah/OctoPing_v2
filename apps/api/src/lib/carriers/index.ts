export type {
  TrackingEvent,
  TrackingResponse,
  TrackingStatus,
  CarrierName,
} from './types';
export { CarrierAdapter } from './base';
export {
  registerCarrier,
  detectCarrier,
  trackShipment,
  listCarriers,
  bootstrapCarriers,
} from './registry';
export {
  buildTrackingResponse,
  normalizeEvents,
  mapStatusText,
} from './mapper';
export { scrapeTracking } from './fallback';
export { isCarrierAvailable, getCarrierBreakerState } from './circuit-breaker';
