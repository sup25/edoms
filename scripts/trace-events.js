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
 * The current topology. These are `direct` exchanges, so routing keys have to
 * be listed explicitly - there is no wildcard bind.
 * Phase 2 moves to topic exchanges, after which this becomes a single "#".
 */
const TOPOLOGY = {
  product_service: ["product_created", "product_deleted"],
  order_service: ["create_order"],
  inventory_service: [
    "stock_decrement",
    "stock_updated",
    "order_confirmed",
    "order_failed",
  ],
  payment_service: ["payment_success", "payment_failure"],
  "product.events": ["product.updated"],
};

/* Where each event goes next, so the trace reads as a story. */
const CONSUMERS = {
  product_created: "-> inventory initializes stock",
  product_deleted: "-> inventory deletes stock + reservations",
  create_order: "-> inventory reserves stock",
  stock_decrement: "-> product refreshes Redis cache",
  stock_updated: "-> product (logs only; see Phase 2)",
  order_confirmed: "-> order marks CONFIRMED",
  order_failed: "-> order marks FAILED, product rolls back cache",
  payment_success: "-> inventory confirms reservation",
  payment_failure: "-> inventory releases stock",
  "product.updated": "-> NOBODY (orphan event, see Phase 2)",
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

  for (const [exchange, routingKeys] of Object.entries(TOPOLOGY)) {
    // passive:false so the tracer works even before a service has started and
    // declared the exchange itself.
    await channel.assertExchange(exchange, "direct", { durable: true });

    // Transient queue: exclusive + autoDelete is correct HERE because this is a
    // debug tap, not a real consumer. It disappears when the tracer stops.
    const q = await channel.assertQueue("", { exclusive: true, autoDelete: true });

    for (const key of routingKeys) {
      await channel.bindQueue(q.queue, exchange, key);
    }

    await channel.consume(
      q.queue,
      (msg) => {
        if (!msg) return;
        count++;

        const color = COLORS[exchange] || "";
        const routingKey = msg.fields.routingKey;
        const next = CONSUMERS[routingKey] || "";

        let eventType = "?";
        let payload;
        try {
          const parsed = JSON.parse(msg.content.toString());
          eventType = parsed.event;
          payload = parsed.data;
        } catch {
          eventType = "<malformed>";
          payload = msg.content.toString().slice(0, 200);
        }

        console.log(
          `${DIM}${stamp()}${RESET} ${color}${BOLD}${exchange}${RESET}` +
            `${DIM}/${routingKey}${RESET}  ${BOLD}${eventType}${RESET}  ${DIM}${next}${RESET}`
        );

        if (SHOW_PAYLOADS) {
          const text = JSON.stringify(payload, null, 2) || String(payload);
          console.log(
            text
              .split("\n")
              .map((l) => `${DIM}          ${l}${RESET}`)
              .join("\n")
          );
        }

        channel.ack(msg);
      },
      { noAck: false }
    );
  }

  const bindings = Object.values(TOPOLOGY).flat().length;
  console.log(
    `${BOLD}EDOMS event tracer${RESET} - watching ${bindings} routing keys across ` +
      `${Object.keys(TOPOLOGY).length} exchanges`
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
