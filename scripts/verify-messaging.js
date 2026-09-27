/*
 * Phase 1 verification against a real RabbitMQ broker.
 *
 * Proves the delivery guarantees the messaging layer claims: durability across
 * a consumer restart, bounded retry, dead-lettering, poison-message handling,
 * and publisher confirms.
 *
 * Requires: RabbitMQ on localhost:5672, and `cd order-service && npm run build`.
 * Run:      node scripts/verify-messaging.js
 */
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "order-service");
const amqplib = require(path.join(ROOT, "node_modules/amqplib"));
const { publishEvent } = require(path.join(ROOT, "dist/rabbitmq/publisher"));
const { subscribeEvent } = require(path.join(ROOT, "dist/rabbitmq/subscriber"));
const { closeBroker } = require(path.join(ROOT, "dist/rabbitmq/connection"));

const URL = "amqp://localhost:5672";
const RUN = Date.now().toString(36);
const EX = `verify_${RUN}`;
const RK = "test_rk";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
}

async function queueDepth(queue) {
  const c = await amqplib.connect(URL);
  const ch = await c.createChannel();
  try {
    const q = await ch.checkQueue(queue);
    return q.messageCount;
  } catch {
    return -1;
  } finally {
    try { await ch.close(); } catch {}
    await c.close();
  }
}

async function cleanup(queues) {
  const c = await amqplib.connect(URL);
  const ch = await c.createChannel();
  for (const q of queues) {
    for (const name of [q, `${q}.retry`, `${q}.dead`]) {
      try { await ch.deleteQueue(name); } catch {}
    }
  }
  try { await ch.deleteExchange(EX); } catch {}
  try { await ch.close(); } catch {}
  await c.close();
}

async function main() {
  const Q1 = `verify.${RUN}.durable`;
  const Q2 = `verify.${RUN}.retry`;
  const Q3 = `verify.${RUN}.poison`;

  // ---------------------------------------------------------------
  // TEST 1: an event published while NO consumer exists is still
  // delivered once a consumer starts. The old exclusive queue lost it.
  // ---------------------------------------------------------------
  {
    // Declare topology first (as a restarted service would), then go "down".
    const c = await amqplib.connect(URL);
    const ch = await c.createChannel();
    await ch.assertExchange(EX, "direct", { durable: true });
    await ch.assertQueue(Q1, {
      durable: true,
      arguments: { "x-dead-letter-exchange": "", "x-dead-letter-routing-key": `${Q1}.retry` },
    });
    await ch.bindQueue(Q1, EX, RK);
    await ch.close();
    await c.close();

    // Service is down. Publish anyway.
    await publishEvent(EX, RK, "order_created", { orderId: 1 });
    await sleep(300);
    const buffered = await queueDepth(Q1);
    check("event survives while consumer is offline", buffered === 1, `queue depth = ${buffered}`);

    // Service comes back up.
    let received = null;
    await subscribeEvent(EX, RK, "direct", async (evt, data) => { received = { evt, data }; }, {
      queue: Q1, retryDelayMs: 500, maxDeliveries: 3,
    });
    await sleep(800);
    check(
      "offline event delivered after consumer restarts",
      received && received.evt === "order_created" && received.data.orderId === 1,
      JSON.stringify(received)
    );
  }

  // ---------------------------------------------------------------
  // TEST 2: a throwing handler retries a bounded number of times and
  // then lands in <queue>.dead instead of being silently acked.
  // ---------------------------------------------------------------
  {
    let attempts = 0;
    await subscribeEvent(EX, "retry_rk", "direct", async () => {
      attempts++;
      throw new Error("handler blew up");
    }, { queue: Q2, retryDelayMs: 500, maxDeliveries: 3 });

    await publishEvent(EX, "retry_rk", "payment_failure", { orderId: 7 });
    await sleep(4000);

    check("throwing handler is retried to the configured limit", attempts === 3, `attempts = ${attempts}`);
    const dead = await queueDepth(`${Q2}.dead`);
    check("exhausted message lands in the dead-letter queue", dead === 1, `${Q2}.dead depth = ${dead}`);
    const main = await queueDepth(Q2);
    check("exhausted message is not left in the main queue", main === 0, `${Q2} depth = ${main}`);
  }

  // ---------------------------------------------------------------
  // TEST 3: malformed JSON goes straight to the DLQ without ever
  // reaching the handler, and without an infinite retry loop.
  // ---------------------------------------------------------------
  {
    let handlerCalls = 0;
    await subscribeEvent(EX, "poison_rk", "direct", async () => { handlerCalls++; }, {
      queue: Q3, retryDelayMs: 500, maxDeliveries: 3,
    });

    const c = await amqplib.connect(URL);
    const ch = await c.createChannel();
    ch.publish(EX, "poison_rk", Buffer.from("{ this is not json"), { persistent: true });
    await ch.close();
    await c.close();
    await sleep(1500);

    check("malformed message never reaches the handler", handlerCalls === 0, `handler calls = ${handlerCalls}`);
    const dead = await queueDepth(`${Q3}.dead`);
    check("malformed message is dead-lettered immediately", dead === 1, `${Q3}.dead depth = ${dead}`);
  }

  // ---------------------------------------------------------------
  // TEST 4: publisher confirms - publishing to a broker that accepted
  // the message resolves; the message is persistent.
  // ---------------------------------------------------------------
  {
    const c = await amqplib.connect(URL);
    const ch = await c.createChannel();
    await ch.assertQueue(`${Q1}.persist`, { durable: true });
    await ch.bindQueue(`${Q1}.persist`, EX, "persist_rk");
    await ch.close();
    await c.close();

    await publishEvent(EX, "persist_rk", "order_created", { orderId: 99 });
    await sleep(300);

    const c2 = await amqplib.connect(URL);
    const ch2 = await c2.createChannel();
    const msg = await ch2.get(`${Q1}.persist`, { noAck: true });
    check("published message is marked persistent", msg && msg.properties.deliveryMode === 2,
      msg ? `deliveryMode = ${msg.properties.deliveryMode}` : "no message");
    check("published message carries a messageId", msg && !!msg.properties.messageId,
      msg ? `messageId = ${msg.properties.messageId}` : "no message");
    try { await ch2.deleteQueue(`${Q1}.persist`); } catch {}
    await ch2.close();
    await c2.close();
  }

  await closeBroker();
  await cleanup([Q1, Q2, Q3]);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error("VERIFY ERROR:", e); process.exit(1); });
