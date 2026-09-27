/*
 * Removes stale exchanges and queues left over from earlier iterations of the
 * event topology. They have no consumers and nothing in the current code
 * references them, but they are still bound to live exchanges, so they keep
 * accumulating copies of every event forever.
 *
 *   node scripts/clean-broker.js          dry run - shows what WOULD be deleted
 *   node scripts/clean-broker.js --yes    actually delete
 *
 * Safety:
 * - only names on the explicit list below are ever touched
 * - anything matching a live queue prefix is refused outright
 * - any queue with a live consumer is skipped
 * - amq.* built-ins and amq.gen-* temporary queues are never touched
 */

const API = process.env.RABBIT_API || "http://localhost:15672/api";
const USER = process.env.RABBIT_USER || "guest";
const PASS = process.env.RABBIT_PASS || "guest";
const AUTH = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");

const APPLY = process.argv.includes("--yes");

/* Leftovers from earlier designs. `invetory_service` is the misspelled exchange
 * that silently broke the order-failure path before Phase 1. */
const STALE_EXCHANGES = [
  "inventory_exchange",
  "order_exchange",
  "payment_exchange",
  "invetory_service",
  // Replaced in Phase 2 by the topic exchanges product.events, order.events,
  // inventory.events and payment.events. Drain their queues before removing.
  "product_service",
  "order_service",
  "inventory_service",
  "payment_service",
];

const STALE_QUEUES = [
  "StockUpdated_queue",
  "decrement.queue",
  "inventory.queue",
  "inventory.updated_queue",
  "order_created_queue",
  "order_events",
  "order_exchange",
  "stock_decrement_queue",
  "stock_updated",
  "stock_updated_queue",
  "update.queue",
];

/* Never delete anything belonging to the current topology. */
const PROTECTED = /^(inventory-service|order-service|product-service)\.|^amq\./;

const GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m";
const DIM = "\x1b[2m", BOLD = "\x1b[1m", RESET = "\x1b[0m";

async function rabbit(path, method = "GET") {
  const res = await fetch(API + path, { method, headers: { Authorization: AUTH } });
  if (method === "GET") return res.json();
  return res;
}

(async () => {
  console.log(
    `\n${BOLD}Broker cleanup${RESET} ${APPLY ? RED + "(APPLYING)" : YELLOW + "(dry run)"}${RESET}\n`
  );

  const queues = await rabbit("/queues/%2F?columns=name,messages,consumers");
  const byName = Object.fromEntries(queues.map((q) => [q.name, q]));

  let toDelete = 0, skipped = 0, messages = 0;

  console.log(`${BOLD}Queues${RESET}`);
  for (const name of STALE_QUEUES) {
    if (PROTECTED.test(name)) {
      console.log(`  ${RED}REFUSE${RESET}  ${name} ${DIM}(protected pattern)${RESET}`);
      skipped++;
      continue;
    }
    const q = byName[name];
    if (!q) {
      console.log(`  ${DIM}absent  ${name}${RESET}`);
      continue;
    }
    if (q.consumers > 0) {
      console.log(`  ${YELLOW}SKIP${RESET}    ${name} ${DIM}(${q.consumers} live consumer)${RESET}`);
      skipped++;
      continue;
    }
    toDelete++;
    messages += q.messages;
    if (!APPLY) {
      console.log(`  would delete  ${name} ${DIM}(${q.messages} messages)${RESET}`);
    } else {
      const res = await rabbit("/queues/%2F/" + encodeURIComponent(name), "DELETE");
      console.log(
        res.ok
          ? `  ${GREEN}deleted${RESET} ${name} ${DIM}(${q.messages} messages discarded)${RESET}`
          : `  ${RED}FAILED${RESET}  ${name} (HTTP ${res.status})`
      );
    }
  }

  console.log(`\n${BOLD}Exchanges${RESET}`);
  for (const name of STALE_EXCHANGES) {
    if (!APPLY) {
      console.log(`  would delete  ${name}`);
    } else {
      const res = await rabbit("/exchanges/%2F/" + encodeURIComponent(name), "DELETE");
      console.log(
        res.ok
          ? `  ${GREEN}deleted${RESET} ${name}`
          : `  ${RED}FAILED${RESET}  ${name} (HTTP ${res.status})`
      );
    }
  }

  console.log(
    `\n${toDelete} queue(s) holding ${messages} stale message(s), ` +
      `${STALE_EXCHANGES.length} exchange(s)${skipped ? `, ${skipped} skipped` : ""}.`
  );
  if (!APPLY) {
    console.log(`${DIM}Nothing was changed. Re-run with --yes to apply.${RESET}\n`);
  } else {
    console.log(`${DIM}Restart is not needed; services re-declare what they use.${RESET}\n`);
  }
})().catch((e) => {
  console.error("Cleanup failed:", e.message);
  console.error("Is the RabbitMQ management UI up on 15672?");
  process.exit(1);
});
