import { detectCarrier, listCarriers } from './registry';
import { mapStatusText, normalizeEvents } from './mapper';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  assert(listCarriers().length >= 10, 'at least 10 carriers registered');

  assert(detectCarrier('1Z999AA10123456784') === 'ups', 'detect UPS');
  assert(detectCarrier('9400111899223344556677') === 'usps', 'detect USPS');
  assert(detectCarrier('TBA123456789012') === 'amazon', 'detect Amazon');
  assert(detectCarrier('JD014600003755022123') === 'dhl', 'detect DHL');

  assert(mapStatusText('Delivered') === 'delivered', 'map delivered');
  assert(mapStatusText('Out for delivery') === 'out_for_delivery', 'map OFD');
  assert(
    mapStatusText('In transit to facility') === 'in_transit',
    'map transit',
  );

  const events = normalizeEvents([
    {
      description: 'Delivered',
      timestamp: '2026-07-04T12:00:00Z',
      location: 'Austin, TX',
    },
    {
      description: 'In transit',
      timestamp: '2026-07-03T08:00:00Z',
      location: 'Dallas, TX',
    },
  ]);
  assert(events[0]?.status === 'delivered', 'events sorted newest first');

  console.log('Carrier registry tests passed');
}

main();
