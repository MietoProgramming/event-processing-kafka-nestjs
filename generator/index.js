const { Kafka } = require('kafkajs');
const { randomUUID } = require('node:crypto');

const brokers = (process.env.KAFKA_BROKERS || 'kafka:9092').split(',');
const topic = process.env.KAFKA_TOPIC || 'events.page_views';
const eventsPerSecond = Number(process.env.EVENTS_PER_SECOND || 1000);

const ticksPerSecond = 10;
const tickIntervalMs = 1000 / ticksPerSecond;

if (eventsPerSecond % ticksPerSecond !== 0) {
  throw new Error('EVENTS_PER_SECOND must be divisible by 10 to maintain exact pacing.');
}

const eventsPerTick = eventsPerSecond / ticksPerSecond;

const kafka = new Kafka({
  clientId: 'page-view-generator',
  brokers,
});

const producer = kafka.producer({
  allowAutoTopicCreation: false,
});

let running = true;
let emittedThisSecond = 0;
let totalEmitted = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomChoice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function makeEvent() {
  const userId = `user_${Math.floor(Math.random() * 50000)
    .toString()
    .padStart(5, '0')}`;

  const event = {
    id: randomUUID(),
    user_id: userId,
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
    key: userId,
    value: JSON.stringify(event),
  };
}

async function publishTickBatch() {
  const messages = new Array(eventsPerTick);

  for (let i = 0; i < eventsPerTick; i += 1) {
    messages[i] = makeEvent();
  }

  await producer.send({
    topic,
    messages,
    acks: 1,
  });

  emittedThisSecond += messages.length;
  totalEmitted += messages.length;
}

async function startProducerLoop() {
  await producer.connect();
  console.log(`[generator] Connected to Kafka brokers: ${brokers.join(', ')}`);
  console.log(`[generator] Publishing ${eventsPerSecond} events/sec to topic ${topic}`);

  const metricsTimer = setInterval(() => {
    console.log(`[generator] rate=${emittedThisSecond}/sec total=${totalEmitted}`);
    emittedThisSecond = 0;
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
