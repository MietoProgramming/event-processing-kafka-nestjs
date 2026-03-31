const { Kafka } = require('kafkajs');
const { randomUUID } = require('node:crypto');

const brokers = (process.env.KAFKA_BROKERS || 'kafka:9092')
  .split(',')
  .map((broker) => broker.trim())
  .filter((broker) => broker.length > 0);
const eventsPerSecond = Number(process.env.EVENTS_PER_SECOND || 1000);
const pageViewsPerSecond = Number(process.env.PAGE_VIEWS_PER_SECOND || 700);
const clicksPerSecond = Number(process.env.CLICKS_PER_SECOND || 290);
const purchasesPerSecond = Number(process.env.PURCHASES_PER_SECOND || 10);

const ticksPerSecond = 10;
const tickIntervalMs = 1000 / ticksPerSecond;

const streamConfigs = [
  {
    topic: process.env.PAGE_VIEWS_TOPIC || 'events.page_views',
    eventsPerSecond: pageViewsPerSecond,
    makeMessage: makePageViewMessage,
  },
  {
    topic: process.env.CLICKS_TOPIC || 'events.clicks',
    eventsPerSecond: clicksPerSecond,
    makeMessage: makeClickMessage,
  },
  {
    topic: process.env.PURCHASES_TOPIC || 'events.purchases',
    eventsPerSecond: purchasesPerSecond,
    makeMessage: makePurchaseMessage,
  },
];

if (!Number.isFinite(eventsPerSecond) || eventsPerSecond <= 0) {
  throw new Error('EVENTS_PER_SECOND must be a positive number.');
}

if (
  !Number.isFinite(pageViewsPerSecond) ||
  !Number.isFinite(clicksPerSecond) ||
  !Number.isFinite(purchasesPerSecond)
) {
  throw new Error('Per-topic event rates must be valid numbers.');
}

const configuredTotal = streamConfigs.reduce(
  (sum, streamConfig) => sum + streamConfig.eventsPerSecond,
  0,
);

if (configuredTotal !== eventsPerSecond) {
  throw new Error(
    `Configured rates must sum to EVENTS_PER_SECOND. Got total=${configuredTotal}, expected=${eventsPerSecond}.`,
  );
}

for (const streamConfig of streamConfigs) {
  if (streamConfig.eventsPerSecond % ticksPerSecond !== 0) {
    throw new Error(
      `${streamConfig.topic} rate must be divisible by ${ticksPerSecond} for exact pacing.`,
    );
  }
}

const streams = streamConfigs.map((streamConfig) => ({
  ...streamConfig,
  eventsPerTick: streamConfig.eventsPerSecond / ticksPerSecond,
}));

const kafka = new Kafka({
  clientId: 'clickstream-generator',
  brokers,
});

const producer = kafka.producer({
  allowAutoTopicCreation: false,
});

let running = true;
let emittedThisSecond = 0;
let totalEmitted = 0;
const emittedPerTopicThisSecond = new Map(streams.map((stream) => [stream.topic, 0]));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomChoice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function makeUserId() {
  return `user_${Math.floor(Math.random() * 50000)
    .toString()
    .padStart(5, '0')}`;
}

function makeSessionId() {
  return `session_${Math.floor(Math.random() * 2_000_000)
    .toString()
    .padStart(7, '0')}`;
}

function makeOrderId() {
  return `order_${Math.floor(Math.random() * 9_000_000)
    .toString()
    .padStart(7, '0')}`;
}

function makePageViewMessage() {
  const userId = makeUserId();
  const sessionId = makeSessionId();

  const event = {
    id: randomUUID(),
    user_id: userId,
    session_id: sessionId,
    event_type: 'page_view',
    payload: {
      path: randomChoice(['/home', '/search', '/pricing', '/docs', '/checkout']),
      referrer: randomChoice(['direct', 'google', 'twitter', 'newsletter', 'ad-campaign']),
      device: randomChoice(['desktop', 'mobile', 'tablet']),
      browser: randomChoice(['chrome', 'safari', 'firefox', 'edge']),
      country: randomChoice(['US', 'DE', 'BR', 'IN', 'JP', 'FR']),
      session_ms: Math.floor(Math.random() * 120000),
    },
    created_at: new Date().toISOString(),
  };

  return {
    key: sessionId,
    value: JSON.stringify(event),
  };
}

function makeClickMessage() {
  const userId = makeUserId();
  const sessionId = makeSessionId();

  const event = {
    id: randomUUID(),
    user_id: userId,
    session_id: sessionId,
    event_type: 'click',
    payload: {
      path: randomChoice(['/home', '/search', '/pricing', '/docs', '/checkout']),
      element_id: randomChoice(['hero-cta', 'search-button', 'pricing-card', 'checkout-button']),
      element_type: randomChoice(['button', 'link', 'banner', 'card']),
      campaign: randomChoice(['spring-sale', 'newsletter', 'retargeting', 'none']),
      device: randomChoice(['desktop', 'mobile', 'tablet']),
    },
    created_at: new Date().toISOString(),
  };

  return {
    key: userId,
    value: JSON.stringify(event),
  };
}

function makePurchaseMessage() {
  const userId = makeUserId();
  const orderId = makeOrderId();

  const event = {
    id: randomUUID(),
    user_id: userId,
    order_id: orderId,
    event_type: 'purchase',
    payload: {
      amount_usd: Number((Math.random() * 450 + 10).toFixed(2)),
      item_count: Math.floor(Math.random() * 5) + 1,
      payment_method: randomChoice(['card', 'paypal', 'wallet']),
      country: randomChoice(['US', 'DE', 'BR', 'IN', 'JP', 'FR']),
    },
    created_at: new Date().toISOString(),
  };

  return {
    key: orderId,
    value: JSON.stringify(event),
  };
}

async function publishTickBatch() {
  const topicMessages = streams.map((stream) => ({
    topic: stream.topic,
    messages: new Array(stream.eventsPerTick),
  }));

  for (let streamIndex = 0; streamIndex < streams.length; streamIndex += 1) {
    const stream = streams[streamIndex];
    const batch = topicMessages[streamIndex];

    for (let messageIndex = 0; messageIndex < stream.eventsPerTick; messageIndex += 1) {
      batch.messages[messageIndex] = stream.makeMessage();
    }
  }

  await producer.sendBatch({
    topicMessages,
    acks: 1,
  });

  for (const batch of topicMessages) {
    emittedThisSecond += batch.messages.length;
    totalEmitted += batch.messages.length;
    emittedPerTopicThisSecond.set(
      batch.topic,
      (emittedPerTopicThisSecond.get(batch.topic) ?? 0) + batch.messages.length,
    );
  }
}

async function startProducerLoop() {
  await producer.connect();
  console.log(`[generator] Connected to Kafka brokers: ${brokers.join(', ')}`);
  console.log(
    `[generator] Publishing total=${eventsPerSecond}/sec as ${streams
      .map((stream) => `${stream.topic}:${stream.eventsPerSecond}/sec`)
      .join(', ')}`,
  );

  const metricsTimer = setInterval(() => {
    const perTopicRates = streams
      .map((stream) => `${stream.topic}=${emittedPerTopicThisSecond.get(stream.topic) ?? 0}/sec`)
      .join(' ');

    console.log(`[generator] rate=${emittedThisSecond}/sec ${perTopicRates} total=${totalEmitted}`);

    emittedThisSecond = 0;

    for (const stream of streams) {
      emittedPerTopicThisSecond.set(stream.topic, 0);
    }
  }, 1000);

  let nextTickAt = Date.now();

  while (running) {
    nextTickAt += tickIntervalMs;

    try {
      await publishTickBatch();
    } catch (error) {
      console.error('[generator] publish error', error);
      await sleep(500);
    }

    const waitMs = nextTickAt - Date.now();

    if (waitMs > 0) {
      await sleep(waitMs);
      continue;
    }

    // If delayed too much, resync to the current clock to avoid runaway backlog.
    if (waitMs < -1000) {
      nextTickAt = Date.now();
    }
  }

  clearInterval(metricsTimer);
}

async function shutdown() {
  running = false;
  await producer.disconnect();
  console.log('[generator] Disconnected from Kafka');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startProducerLoop().catch(async (error) => {
  console.error('[generator] fatal error', error);
  try {
    await producer.disconnect();
  } catch (_error) {
    // Ignore disconnect failures during fatal shutdown.
  }
  process.exit(1);
});
