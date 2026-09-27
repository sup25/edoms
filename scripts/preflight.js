/*
 * Checks everything EDOMS needs before you start it.
 *
 * Run:  node scripts/preflight.js
 */

const net = require("net");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SERVICES = [
  "auth-service",
  "product-service",
  "inventory-service",
  "order-service",
  "payment-service",
];

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function probe(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    const finish = (up) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
    setTimeout(() => finish(false), timeout);
  });
}

async function main() {
  let blocking = 0;

  console.log(`\n${BOLD}Infrastructure${RESET}`);
  const infra = [
    ["PostgreSQL", 5432, true, "required by all five services"],
    ["RabbitMQ", 5672, true, "required for every event"],
    ["RabbitMQ UI", 15672, false, "http://localhost:15672 (guest/guest)"],
    ["Redis", 6379, true, "required by order-service and product-service"],
  ];
  for (const [name, port, required, note] of infra) {
    const up = await probe("127.0.0.1", port);
    if (!up && required) blocking++;
    const mark = up ? `${GREEN}UP  ${RESET}` : required ? `${RED}DOWN${RESET}` : `${YELLOW}down${RESET}`;
    console.log(`  ${mark} ${name.padEnd(13)} ${String(port).padEnd(6)} ${DIM}${note}${RESET}`);
  }

  console.log(`\n${BOLD}Service config${RESET}`);
  for (const service of SERVICES) {
    const envPath = path.join(ROOT, service, ".env");
    const hasEnv = fs.existsSync(envPath);
    const hasModules = fs.existsSync(path.join(ROOT, service, "node_modules"));
    if (!hasEnv || !hasModules) blocking++;

    const bits = [
      hasEnv ? `${GREEN}.env${RESET}` : `${RED}.env MISSING${RESET}`,
      hasModules ? `${GREEN}node_modules${RESET}` : `${RED}node_modules MISSING${RESET}`,
    ];
    console.log(`  ${service.padEnd(20)} ${bits.join("  ")}`);
  }

  console.log(`\n${BOLD}Service ports${RESET}`);
  const ports = [
    ["auth-service", 5000],
    ["product-service", 5001],
    ["inventory-service", 5002],
    ["order-service", 5003],
    ["payment-service", 5004],
  ];
  for (const [name, port] of ports) {
    const up = await probe("127.0.0.1", port);
    console.log(
      `  ${up ? `${GREEN}running${RESET}` : `${DIM}stopped${RESET}`} ${name.padEnd(20)} ${port}`
    );
  }

  if (blocking > 0) {
    console.log(`\n${RED}${BOLD}${blocking} blocking issue(s).${RESET} See docs/RUNNING.md.\n`);
    process.exit(1);
  }
  console.log(`\n${GREEN}${BOLD}Ready.${RESET} Start with: npm run dev\n`);
}

main();
