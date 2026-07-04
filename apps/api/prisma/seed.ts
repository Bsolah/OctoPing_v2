import { PrismaClient } from '@prisma/client';

import { encrypt } from '../src/lib/encryption';

const prisma = new PrismaClient();

async function main() {
  const shopDomain = 'test-store.myshopify.com';

  const merchant = await prisma.merchant.upsert({
    where: { shopDomain },
    update: {},
    create: {
      shopDomain,
      shopifyShopId: BigInt(1234567890),
      accessToken: encrypt('shpat_test_access_token_seed'),
      planTier: 'growth',
      aiTone: 'friendly_professional',
      escalationThreshold: 0.7,
      isActive: true,
    },
  });

  await prisma.message.deleteMany({
    where: {
      conversation: {
        merchantId: merchant.id,
      },
    },
  });
  await prisma.event.deleteMany({
    where: { merchantId: merchant.id },
  });
  await prisma.conversation.deleteMany({
    where: { merchantId: merchant.id },
  });
  await prisma.knowledgeBase.deleteMany({
    where: { merchantId: merchant.id },
  });
  await prisma.agent.deleteMany({
    where: { merchantId: merchant.id },
  });
  await prisma.order.deleteMany({
    where: { merchantId: merchant.id },
  });

  const conversationOne = await prisma.conversation.create({
    data: {
      merchantId: merchant.id,
      customerEmail: 'alice@example.com',
      customerShopifyId: BigInt(1001),
      channel: 'widget',
      status: 'active',
      sentimentScore: 0.2,
      revenueImpact: 49.99,
      messages: {
        create: [
          {
            senderType: 'customer',
            content: 'Where is my order #1001?',
          },
          {
            senderType: 'ai',
            content:
              'I can help with that. Your order is currently in transit with UPS.',
            aiConfidence: 0.92,
            aiIntent: 'order_tracking',
            metadata: { carrier: 'UPS' },
          },
          {
            senderType: 'customer',
            content: 'Thanks! When will it arrive?',
          },
        ],
      },
      events: {
        create: [
          {
            merchantId: merchant.id,
            eventType: 'conversation.created',
            properties: { channel: 'widget' },
          },
        ],
      },
    },
  });

  const conversationTwo = await prisma.conversation.create({
    data: {
      merchantId: merchant.id,
      customerEmail: 'bob@example.com',
      customerShopifyId: BigInt(1002),
      channel: 'email',
      status: 'resolved',
      aiResolution: true,
      sentimentScore: 0.8,
      revenueImpact: 120.0,
      messages: {
        create: [
          {
            senderType: 'customer',
            content: 'Do you offer free returns?',
          },
          {
            senderType: 'ai',
            content:
              'Yes — we offer free returns within 30 days of delivery on all full-price items.',
            aiConfidence: 0.97,
            aiIntent: 'returns_policy',
          },
          {
            senderType: 'system',
            content: 'Conversation marked as resolved by AI.',
          },
        ],
      },
      events: {
        create: [
          {
            merchantId: merchant.id,
            eventType: 'conversation.resolved',
            properties: { aiResolution: true },
          },
        ],
      },
    },
  });

  await prisma.knowledgeBase.createMany({
    data: [
      {
        merchantId: merchant.id,
        contentType: 'faq',
        title: 'Order tracking',
        content:
          'Customers can track orders using the tracking link in their shipping confirmation email.',
        metadata: { tags: ['shipping', 'tracking'] },
      },
      {
        merchantId: merchant.id,
        contentType: 'policy',
        title: 'Return policy',
        content:
          'We accept free returns within 30 days of delivery for unused items in original packaging.',
        metadata: { tags: ['returns'] },
      },
      {
        merchantId: merchant.id,
        contentType: 'shipping',
        title: 'Shipping times',
        content:
          'Standard shipping takes 3–5 business days. Express shipping takes 1–2 business days.',
        metadata: { tags: ['shipping', 'delivery'] },
      },
    ],
  });

  await prisma.agent.create({
    data: {
      merchantId: merchant.id,
      email: 'owner@test-store.myshopify.com',
      name: 'Store Owner',
      role: 'owner',
      isOnline: true,
      workingHours: {
        timezone: 'America/New_York',
        days: {
          mon: { start: '09:00', end: '17:00' },
          tue: { start: '09:00', end: '17:00' },
          wed: { start: '09:00', end: '17:00' },
          thu: { start: '09:00', end: '17:00' },
          fri: { start: '09:00', end: '17:00' },
        },
      },
    },
  });

  await prisma.order.create({
    data: {
      merchantId: merchant.id,
      shopifyOrderId: BigInt(5001),
      customerEmail: 'alice@example.com',
      totalPrice: 49.99,
      fulfillmentStatus: 'in_transit',
      trackingNumbers: ['1Z999AA10123456784'],
      carrier: 'UPS',
    },
  });

  console.log('Seed completed:');
  console.log(`  Merchant: ${merchant.shopDomain} (${merchant.id})`);
  console.log(`  Conversations: ${conversationOne.id}, ${conversationTwo.id}`);
  console.log('  Knowledge base entries: 3');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
