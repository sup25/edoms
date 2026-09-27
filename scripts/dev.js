/*
 * Starts all five services in one terminal with prefixed, colour-coded output.
 *
 * Run:  node scripts/dev.js
 *       node scripts/dev.js order product     (only these two)
 *
 * Ctrl+C stops everything. Each service still has its own `npm run dev` if you
 * would rather run them in separate terminals.
 */

const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const SERVICES = [
  { name: "auth", dir: "auth-service", port: 5000, color: "\x1b[34m" },
  { name: "product", dir: "product-service", port: 5001, color: "\x1b[35m" },
  { name: "inventory", dir: "inventory-service", port: 5002, color: "\x1b[33m" },
  { name: "order", dir: "order-service", port: 5003, color: "\x1b[36m" },
  { name: "payment", dir: "payment-service", port: 5004, color: "\x1b[32m" },
];

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const filter = process.argv.slice(2);
const selected = filter.length
  ? SERVICES.filter((s) => filter.includes(s.name) || filter.includes(s.dir))
  : SERVICES;

if (!selected.length) {
  console.error(`No matching services. Known: ${SERVICES.map((s) => s.name).join(", ")}`);
  process.exit(1);
}

const width = Math.max(...selected.map((s) => s.name.length));
const children = [];

function pipe(service, stream) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      console.log(`${service.color}${BOLD}${service.name.padEnd(width)}${RESET} ${DIM}|${RESET} ${line}`);
    }
  });
}

for (const service of selected) {
  const child = spawn("npm", ["run", "dev"], {
    cwd: path.join(ROOT, service.dir),
    shell: true, // required for npm on Windows
    env: process.env,
  });

  pipe(service, child.stdout);
  pipe(service, child.stderr);

  child.on("exit", (code) => {
    console.log(
      `${service.color}${BOLD}${service.name.padEnd(width)}${RESET} ${DIM}|${RESET} ` +
        `exited with code ${code}`
    );
  });

  children.push(child);
  console.log(
    `${service.color}${BOLD}${service.name.padEnd(width)}${RESET} ${DIM}| starting on port ${service.port}${RESET}`
  );
}

console.log(
  `\n${DIM}Watch events in another terminal: node scripts/trace-events.js${RESET}\n`
);

function shutdown() {
  console.log(`\n${DIM}Stopping ${children.length} services...${RESET}`);
  for (const child of children) {
    // SIGTERM lets each service run its graceful-shutdown handler and drain
    // in-flight messages before the broker connection closes.
    child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 3000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
