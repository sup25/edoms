/*
 * One-time Phase 2 broker migration.
 *
 * Phase 2 moved every domain onto a `topic` exchange. RabbitMQ will not let
 * you redeclare an existing exchange with a different type - it answers
 * 406 PRECONDITION_FAILED - so any exchange left over from the `direct` era
 * has to be removed before the services can start.
 *
 * `product.events` is the one that clashes: it existed as `direct` because the
 * old orphaned `product.updated` publish created it.
 *
 *   node scripts/migrate-broker-phase2.js          dry run
 *   node scripts/migrate-broker-phase2.js --yes    delete the clashing exchanges
 *
 * Run it with the services STOPPED. They recreate the exchange with the right
 * type on their next connect, so nothing needs to be created by hand.
 *
 * Deleting an exchange also drops its bindings. Any message sitting in a queue
 * bound to it stays in that queue; only routing stops. Since nothing consumed
 * the old `product.events`, there is nothing to lose here.
 */

const API = process.env.RABBIT_API || "http://localhost:15672/api";
const USER = process.env.RABBIT_USER || "guest";
const PASS = process.env.RABBIT_PASS || "guest";
const AUTH = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");

const APPLY = process.argv.includes("--yes");

/** The Phase 2 contract: every one of these must be a topic exchange. */
const REQUIRED = {
  "product.events": "topic",
  "order.events": "topic",
  "inventory.events": "topic",
  "payment.events": "topic",
};

const GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m";
const DIM = "\x1b[2m", BOLD = "\x1b[1m", RESET = "\x1b[0m";

(async () => {
  console.log(
    `\n${BOLD}Phase 2 broker migration${RESET} ${APPLY ? RED + "(APPLYING)" : YELLOW + "(dry run)"}${RESET}\n`
  );

  const res = await fetch(`${API}/exchanges/%2F?columns=name,type`, {
    headers: { Authorization: AUTH },
  });
  if (!res.ok) {
    console.error(`Could not read exchanges (HTTP ${res.status}). Is RabbitMQ up on 15672?`);
    process.exit(1);
  }
  const existing = Object.fromEntries((await res.json()).map((e) => [e.name, e.type]));

  let clashes = 0;
  for (const [name, wantType] of Object.entries(REQUIRED)) {
    const currentType = existing[name];

    if (!currentType) {
      console.log(`  ${DIM}absent   ${name} - services will create it as ${wantType}${RESET}`);
      continue;
    }
    if (currentType === wantType) {
      console.log(`  ${GREEN}ok       ${RESET}${name} ${DIM}(already ${wantType})${RESET}`);
      continue;
    }

    clashes++;
    if (!APPLY) {
      console.log(
        `  ${YELLOW}CLASH    ${RESET}${name} ${DIM}is '${currentType}', needs '${wantType}'` +
          ` - would delete${RESET}`
      );
    } else {
      const del = await fetch(`${API}/exchanges/%2F/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: { Authorization: AUTH },
      });
      console.log(
        del.ok
          ? `  ${GREEN}deleted  ${RESET}${name} ${DIM}(was '${currentType}')${RESET}`
          : `  ${RED}FAILED   ${RESET}${name} (HTTP ${del.status})`
      );
    }
  }

  if (clashes === 0) {
    console.log(`\n${GREEN}${BOLD}Nothing to migrate.${RESET}\n`);
  } else if (!APPLY) {
    console.log(
      `\n${clashes} exchange(s) would be deleted. Nothing was changed.` +
        `\n${DIM}Stop the services, re-run with --yes, then start them again.${RESET}\n`
    );
  } else {
    console.log(`\n${GREEN}${BOLD}Done.${RESET} Start the services; they will recreate them.\n`);
  }
})().catch((e) => {
  console.error("Migration failed:", e.message);
  process.exit(1);
});
