/*
 * End-to-end smoke test. Drives a real order through all five services and
 * asserts the state each step should produce.
 *
 *   node scripts/smoke-test.js          happy path: order -> reserved -> paid -> confirmed
 *   node scripts/smoke-test.js --fail   failure path: order -> reserved -> payment fails
 *                                       -> stock rolled back -> order failed
 *
 * Requires: all five services running (npm run dev) and preflight green.
 * Exits non-zero if any assertion fails, so it is CI-usable.
 *
 * The --fail mode publishes a synthetic `payment_failure` event rather than
 * forcing a Stripe decline, so it is deterministic and makes no external call.
 * It exercises the compensating-transaction chain that was silently broken by
 * the `invetory_service` exchange typo before Phase 1.
 */

const path = require("path");
const fs = require("fs");

const AUTH = "http://localhost:5000/api/v1";
const PRODUCT = "http://localhost:5001/api/v1";
const INVENTORY = "http://localhost:5002/api/v1";
const ORDER = "http://localhost:5003/api/v1";
const PAYMENT = "http://localhost:5004/api/v1";

const FAIL_MODE = process.argv.includes("--fail");
const OVERSELL_MODE = process.argv.includes("--oversell");
const DUPLICATE_MODE = process.argv.includes("--duplicate");
const PASSWORD = "Password123!";
const QTY = 2;
const START_STOCK = 100;

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? GREEN + "PASS" : RED + "FAIL"}${RESET} ${label}` +
      (ok ? `  ${DIM}${JSON.stringify(actual)}${RESET}` : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  );
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

/** Builds a Phase 2 envelope, the shape every consumer now validates. */
function envelope(eventType, payload, messageId) {
  return {
    eventId: messageId || `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventType,
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    producer: "smoke-test",
    correlationId: `smoke-corr-${Date.now()}`,
    payload,
  };
}

function requireFromServices(moduleName) {
  for (const service of ["order-service", "inventory-service", "product-service", "payment-service"]) {
    const candidate = path.resolve(__dirname, "..", service, "node_modules", moduleName);
    if (fs.existsSync(candidate)) return require(candidate);
  }
  throw new Error(`Cannot find ${moduleName}. Run: npm run install:all`);
}

async function publishPaymentFailure(orderId, messageId) {
  const amqplib = requireFromServices("amqplib");
  const connection = await amqplib.connect(process.env.BROKER_URL || "amqp://localhost:5672");
  const channel = await connection.createChannel();
  await channel.assertExchange("payment.events", "topic", { durable: true });
  channel.publish(
    "payment.events",
    "payment.failed",
    Buffer.from(JSON.stringify(envelope("payment.failed", { orderId: String(orderId) }))),
    // messageId is what the consumer deduplicates on. Passing the SAME id
    // twice simulates a broker redelivery.
    messageId ? { persistent: true, messageId } : { persistent: true }
  );
  await sleep(300);
  await channel.close();
  await connection.close();
}

async function publishOrderCreated(orderId, productId, quantity) {
  const amqplib = requireFromServices("amqplib");
  const connection = await amqplib.connect(
    process.env.BROKER_URL || "amqp://localhost:5672"
  );
  const channel = await connection.createChannel();
  await channel.assertExchange("order.events", "topic", { durable: true });
  channel.publish(
    "order.events",
    "order.created",
    Buffer.from(
      JSON.stringify(envelope("order.created", { orderId, items: [{ productId, quantity }] }))
    ),
    { persistent: true, messageId: `inject-${Date.now()}` }
  );
  await sleep(300);
  await channel.close();
  await connection.close();
}

async function register(role) {
  const email = `${role}+${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`;
  const endpoint = role === "admin" ? "admins" : "users";
  const created = await api(`${AUTH}/${endpoint}`, {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (created.status >= 400) throw new Error(`register ${role} failed: ${JSON.stringify(created.body)}`);

  const login = await api(`${AUTH}/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const token = login.body?.data?.accessToken;
  if (!token) throw new Error(`login ${role} failed: ${JSON.stringify(login.body)}`);

  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
  return { token, headers: { Authorization: `Bearer ${token}` }, id: Number(claims.userId) };
}

(async () => {
  console.log(
    `\n${BOLD}EDOMS smoke test${RESET} - ${
      OVERSELL_MODE
        ? "OVERSELL (handler must refuse)"
        : DUPLICATE_MODE
        ? "DUPLICATE delivery (idempotency)"
        : FAIL_MODE
        ? "FAILURE path (compensation)"
        : "HAPPY path"
    }\n`
  );

  const admin = await register("admin");
  const user = await register("user");
  console.log(`${DIM}  admin and user registered (userId=${user.id})${RESET}\n`);

  // --- product ---
  const slug = `widget-${Date.now().toString(36)}`;
  const product = await api(`${PRODUCT}/createproduct`, {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ name: "Smoke Widget", price: 19.99, slug }),
  });
  const productId = product.body?.data?.id;
  if (!productId) throw new Error(`create product failed: ${JSON.stringify(product.body)}`);
  console.log(`${BOLD}product ${productId} created${RESET}`);

  await sleep(1500);
  const initial = await api(`${INVENTORY}/stock/${productId}`);
  assert("new product initializes at 0 stock (defect #16)", initial.body?.data, 0);

  await api(`${INVENTORY}/updatestock`, {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ id: productId, stock: START_STOCK }),
  });
  await sleep(800);
  const stocked = await api(`${INVENTORY}/stock/${productId}`);
  assert("stock set", stocked.body?.data, START_STOCK);

  // --- order ---
  const orderQty = QTY;
  console.log(`\n${BOLD}placing order${RESET}`);
  const order = await api(`${ORDER}/createorder`, {
    method: "POST",
    headers: user.headers,
    body: JSON.stringify({ userId: user.id, items: [{ productId, quantity: orderQty }] }),
  });
  const orderId = order.body?.data?.id;
  if (!orderId) throw new Error(`create order failed: ${JSON.stringify(order.body)}`);
  console.log(`${DIM}  order ${orderId}${RESET}`);

  await sleep(2500);

  if (OVERSELL_MODE) {
    /*
     * order-service validates stock synchronously over HTTP before publishing,
     * so simply ordering too much is rejected at the API and no event is ever
     * produced. That pre-check is racy - stock can change between the check
     * and the event being consumed - so the handler must refuse on its own.
     * Inject an oversized order_created to prove it does.
     */
    const huge = START_STOCK * 100;
    console.log(
      `\n${BOLD}injecting order_created for ${huge} units${RESET} ` +
        `${DIM}(stock is ${START_STOCK - QTY})${RESET}`
    );
    await publishOrderCreated(orderId, productId, huge);
    await sleep(3500);

    const stock = await api(`${INVENTORY}/stock/${productId}`);
    assert(
      "handler refused - stock unchanged, nothing reserved (defect #5)",
      stock.body?.data,
      START_STOCK - QTY
    );
    assert("stock never went negative", stock.body?.data >= 0, true);

    const status = await api(`${ORDER}/orderStatus/${orderId}`);
    assert("order FAILED via reservation_failed (defect #6)", status.body?.data, "failed");

    console.log(
      failures === 0
        ? `
${GREEN}${BOLD}All checks passed.${RESET}  productId=${productId} orderId=${orderId}
`
        : `
${RED}${BOLD}${failures} check(s) failed.${RESET}
`
    );
    process.exit(failures === 0 ? 0 : 1);
  }

  const reserved = await api(`${INVENTORY}/stock/${productId}`);
  assert("stock decremented by reservation", reserved.body?.data, START_STOCK - QTY);

  const pending = await api(`${ORDER}/orderStatus/${orderId}`);
  assert("order is pending before payment", pending.body?.data, "pending");

  if (DUPLICATE_MODE) {
    // Defect #8: the SAME messageId delivered twice must only credit once.
    const messageId = `dup-test-${Date.now()}`;
    console.log(`
${BOLD}publishing payment_failure TWICE with messageId=${messageId}${RESET}`);

    await publishPaymentFailure(orderId, messageId);
    await sleep(3000);
    const afterFirst = await api(`${INVENTORY}/stock/${productId}`);
    assert("first delivery restores stock", afterFirst.body?.data, START_STOCK);

    await publishPaymentFailure(orderId, messageId);
    await sleep(3000);
    const afterSecond = await api(`${INVENTORY}/stock/${productId}`);
    assert(
      "duplicate delivery does NOT inflate stock (defect #7/#8)",
      afterSecond.body?.data,
      START_STOCK
    );

    const status = await api(`${ORDER}/orderStatus/${orderId}`);
    assert("order failed exactly once", status.body?.data, "failed");

    console.log(
      failures === 0
        ? `
${GREEN}${BOLD}All checks passed.${RESET}  productId=${productId} orderId=${orderId}
`
        : `
${RED}${BOLD}${failures} check(s) failed.${RESET}
`
    );
    process.exit(failures === 0 ? 0 : 1);
  }

  if (!FAIL_MODE) {
    // --- happy path: real Stripe TEST-mode charge ---
    console.log(`\n${BOLD}paying (Stripe test mode)${RESET}`);
    const paid = await api(`${PAYMENT}/create-payment`, {
      method: "POST",
      body: JSON.stringify({
        orderId,
        userId: user.id,
        items: [{ productId, quantity: QTY, price: 19.99 }],
      }),
    });
    assert("payment succeeded", paid.body?.status, "success");

    await sleep(2500);
    const confirmed = await api(`${ORDER}/orderStatus/${orderId}`);
    assert("order CONFIRMED via payment_success -> order_confirmed", confirmed.body?.data, "confirmed");

    const res = await api(`${INVENTORY}/reservedstock/${orderId}`);
    assert("reservation confirmed", res.body?.data?.[0]?.status, "confirmed");

    const finalStock = await api(`${INVENTORY}/stock/${productId}`);
    assert("stock stays decremented", finalStock.body?.data, START_STOCK - QTY);
  } else {
    // --- failure path: compensation chain ---
    console.log(`\n${BOLD}publishing payment_failure${RESET}`);
    console.log(`${DIM}  chain: payment_failure -> inventory releases stock${RESET}`);
    console.log(`${DIM}         -> order_failed -> order marks FAILED${RESET}`);
    console.log(`${DIM}  (this chain was dead before Phase 1 - the exchange typo)${RESET}`);
    await publishPaymentFailure(orderId);

    await sleep(3000);
    const rolledBack = await api(`${INVENTORY}/stock/${productId}`);
    assert("stock rolled back to original", rolledBack.body?.data, START_STOCK);

    const failed = await api(`${ORDER}/orderStatus/${orderId}`);
    assert("order marked FAILED (the Phase 1 typo fix)", failed.body?.data, "failed");

    const res = await api(`${INVENTORY}/reservedstock/${orderId}`);
    assert("reservation canceled", res.body?.data?.[0]?.status, "canceled");
  }

  console.log(
    failures === 0
      ? `\n${GREEN}${BOLD}All checks passed.${RESET}  productId=${productId} orderId=${orderId}\n`
      : `\n${RED}${BOLD}${failures} check(s) failed.${RESET}  productId=${productId} orderId=${orderId}\n`
  );
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(`\n${RED}Smoke test error:${RESET}`, e.message);
  console.error(`${DIM}Are all five services running? Try: node scripts/preflight.js${RESET}`);
  process.exit(1);
});
