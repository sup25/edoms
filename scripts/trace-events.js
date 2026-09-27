/*
 * Live event tracer.
 *
 * Binds its own temporary queues alongside the real consumers and prints every
 * event flowing through EDOMS as it happens. It receives *copies* - RabbitMQ
 * delivers to every queue bound with a matching routing key - so it never
 * steals messages from the real services.
 *
 * Run:  node scripts/trace-events.js
 *       node scripts/trace-events.js --payloads    (show full payloads)
 *
 * Requires RabbitMQ on localhost:5672. Safe to start and stop at any time.
 */

const path = require("path");
const fs = require("fs");

/* There is no root node_modules yet (npm workspaces land in Phase 7), so
 * borrow amqplib from whichever service has it installed. */
function requireFromServices(moduleName) {
  const services = [
    "order-service",
    "inventory-service",
    "product-service",
    "payment-service",
  ];
  for (const service of services) {
    const candidate = path.resolve(__dirname, "..", service, "node_modules", moduleName);
    if (fs.existsSync(candidate)) return require(candidate);
  }
  console.error(
    `Could not find '${moduleName}'. Run: npm run install:all`
  );
  process.exit(1);
}

const amqplib = requireFromServices("amqplib");

const URL = process.env.BROKER_URL || "amqp://localhost:5672";
const SHOW_PAYLOADS = process.argv.includes("--payloads");

/*
 * Topic exchanges, one per producing domain. Because they are topic (not
 * direct) exchanges, a single "#" binding catches every event in the domain -
 * no more listing each routing key by hand, and new events show up here
 * automatically.
 */
const EXCHANGES = [
  "product.events",
  "order.events",
  "inventory.events",
  "payment.events",
];

/* Where each event goes next, so the trace reads as a story. */
const CONSUMERS = {
  "product.created": "-> inventory initializes stock",
  "product.updated": "-> order invalidates its product cache",
  "product.deleted": "-> inventory deletes stock, order drops its cache",
  "order.created": "-> inventory reserves stock",
  "inventory.stock.reserved": "-> product refreshes Redis cache",
  "inventory.stock.updated": "-> product invalidates its stock cache",
  "inventory.reservation.confirmed": "-> order marks CONFIRMED",
  "inventory.reservation.released": "-> order marks FAILED, product rolls back cache",
  "inventory.reservation.failed": "-> order marks FAILED (insufficient stock)",
  "payment.succeeded": "-> inventory confirms reservation",
  "payment.failed": "-> inventory releases stock",
};

const COLORS = {
  product_service: "\x1b[35m",
  order_service: "\x1b[36m",
  inventory_service: "\x1b[33m",
  payment_service: "\x1b[32m",
  "product.events": "\x1b[31m",
};
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function stamp() {
  return new Date().toISOString().slice(11, 23);
}

let count = 0;

async function main() {
  const connection = await amqplib.connect(URL);
  const channel = await connection.createChannel();

  for (const exchange of EXCHANGES) {
    await channel.assertExchange(exchange, "topic", { durable: true });

    // Transient queue: exclusive + autoDelete is correct HERE because this is
    // a debug tap, not a real consumer. It disappears when the tracer stops.
    const q = await channel.assertQueue("", { exclusive: true, autoDelete: true });
    await channel.bindQueue(q.queue, exchange, "#");

    await channel.consume(
      q.queue,
      (msg) => {
        if (!msg) return;
        count++;

        const color = COLORS[exchange] || "";
        const routingKey = msg.fields.routingKey;
        const next = CONSUMERS[routingKey] || "";

        let eventType = routingKey;
        let payload;
        let correlationId = "";
        try {
          const parsed = JSON.parse(msg.content.toString());
          // Phase 2 envelope, with a fallback for anything still using the
          // old { event, data } shape.
          eventType = parsed.eventType || parsed.event || routingKey;
          payload = parsed.payload !== undefined ? parsed.payload : parsed.data;
          correlationId = parsed.correlationId || msg.properties.correlationId || "";
        } catch {
          eventType = "<malformed>";
          payload = msg.content.toString().slice(0, 200);
        }

        const corr = correlationId ? `${DIM}[${correlationId.slice(0, 8)}]${RESET} ` : "";
        console.log(
          `${DIM}${stamp()}${RESET} ${corr}${color}${BOLD}${eventType}${RESET}  ${DIM}${next}${RESET}`
        );

        if (SHOW_PAYLOADS) {
          const text = JSON.stringify(payload, null, 2) || String(payload);
          console.log(
            text
              .split(/\r?\n/)
              .map((l) => `${DIM}          ${l}${RESET}`)
              .join("\n")
          );
        }

        channel.ack(msg);
      },
      { noAck: false }
    );
  }

  console.log(
    `${BOLD}EDOMS event tracer${RESET} - watching ALL events across ` +
      `${EXCHANGES.length} topic exchanges`
  );
  console.log(
    `${DIM}Receives copies only; real consumers are unaffected. Ctrl+C to stop.` +
      `${SHOW_PAYLOADS ? "" : " Use --payloads for full event bodies."}${RESET}\n`
  );

  const shutdown = async () => {
    console.log(`\n${DIM}Traced ${count} events. Closing.${RESET}`);
    try {
      await channel.close();
      await connection.close();
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Tracer failed:", error.message);
  console.error("Is RabbitMQ running on", URL, "?");
  process.exit(1);
});
