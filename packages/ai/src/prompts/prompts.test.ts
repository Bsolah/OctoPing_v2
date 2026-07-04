import { buildSystemPrompt } from '../rag/context-builder';
import { getPreSalePrompt } from './pre-sale';
import { getSystemPrompt } from './system';
import { getWismoPrompt } from './wismo';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const systemV1 = getSystemPrompt('prompt_v1');
  const systemV2 = getSystemPrompt('prompt_v2');
  assert(systemV1.version === 'prompt_v1', 'system v1 version');
  assert(systemV2.version === 'prompt_v2', 'system v2 version');
  assert(systemV1.template !== systemV2.template, 'versions differ');

  const rendered = buildSystemPrompt(
    {
      id: 'm1',
      shopName: 'Acme Store',
      shopDomain: 'acme.myshopify.com',
      tone: 'friendly_professional',
    },
    'friendly_professional',
    ['Never offer free shipping'],
    systemV1.template,
  );

  assert(rendered.includes('Acme Store'), 'shop name injected');
  assert(rendered.includes('Never offer free shipping'), 'rules injected');
  assert(
    rendered.includes('Never invent') || rendered.includes('hallucinate'),
    'constraints present',
  );

  assert(getPreSalePrompt('prompt_v1').id === 'pre_sale', 'pre-sale prompt');
  assert(getWismoPrompt('prompt_v2').version === 'prompt_v2', 'wismo v2');

  console.log('Prompt versioning tests passed');
}

main();
