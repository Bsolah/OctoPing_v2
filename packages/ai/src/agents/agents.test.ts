import { routeIntent } from './supervisor';
import {
  CONFIDENCE_THRESHOLD,
  IntentType,
  SentimentType,
  SpecialistOutputSchema,
} from './types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  assert(routeIntent(IntentType.PRE_SALE) === 'pre_sale', 'pre_sale route');
  assert(routeIntent(IntentType.WISMO) === 'wismo', 'wismo route');
  assert(routeIntent(IntentType.RETURNS) === 'returns', 'returns route');
  assert(routeIntent(IntentType.TECHNICAL) === 'technical', 'technical route');
  assert(
    routeIntent(IntentType.SMALL_TALK) === 'small_talk',
    'small_talk route',
  );
  assert(
    routeIntent(IntentType.ESCALATION_REQUEST) === 'escalation',
    'escalation route',
  );
  assert(routeIntent(IntentType.UNKNOWN) === 'escalation', 'unknown route');

  assert(CONFIDENCE_THRESHOLD === 0.7, 'confidence threshold');
  assert(SentimentType.FRUSTRATED === 'frustrated', 'frustrated sentiment');

  const specialist = SpecialistOutputSchema.parse({
    response: 'Here is the Classic Tee — $29.',
    actions: [{ type: 'add_to_cart', payload: { productId: '1' } }],
    confidence: 0.9,
    sources: [
      {
        title: 'Classic Tee',
        url: '/products/classic-tee',
        productId: 'gid://shopify/Product/1',
      },
    ],
  });
  assert(specialist.actions.length === 1, 'specialist actions');
  assert(specialist.sources[0]?.title === 'Classic Tee', 'specialist sources');

  console.log('Agent routing/schema tests passed');
}

main();
