import { spinner, echo, $, type ProcessPromise } from "zx";
import { waitForHealth } from "../wait-for-health";

$.verbose = true;

const FACILITATOR_URL = "http://localhost:4000";
const RESOURCE_SERVER_URL = "http://localhost:3000";

async function runX402Payments() {
  await $`pnpm tsx solana-example/squads-payment.ts`;
  await $`pnpm tsx solana-example/solana-exact-payment.ts`;
  await $`pnpm tsx solana-example/token2022-exact-payment.ts`;
  await $`pnpm tsx solana-example/ows-exact-payment.ts`;
  await $`pnpm tsx solana-example/flex-payment.ts`;
  // XXX - Add the Crossmint and Ledger payment in future.
}

async function runMPPPayments() {
  await $`pnpm tsx solana-example/mpp-token-payment.ts`;
  await $`pnpm tsx solana-example/mpp-sol-payment.ts`;
  await $`pnpm tsx solana-example/solana-exact-payment.ts`;
}

async function runDynamicPricingPayments() {
  await $`pnpm tsx solana-example/dynamic-pricing-payment.ts`;
}

async function runUsingResourceServer(
  resourceServer: ProcessPromise,
  payments: () => Promise<void>,
) {
  let success = true;

  try {
    await spinner("Waiting for resource server health endpoint...", () =>
      waitForHealth(`${RESOURCE_SERVER_URL}/health`),
    );
    await payments();
  } catch (e) {
    echo("error running payments: ", e);
    success = false;
  }

  echo("Killing off resource server...");
  void resourceServer.nothrow(true);
  await resourceServer.kill();

  return success;
}

const facilitator = $`cd ${import.meta.dirname}/../../apps/facilitator && pnpm tsx src`;
await spinner("Waiting for facilitator health endpoint...", () =>
  waitForHealth(`${FACILITATOR_URL}/health`),
);

let ret = 0;

if (
  !(await runUsingResourceServer(
    $`pnpm tsx solana-example/server-hono.ts`,
    runX402Payments,
  ))
) {
  ret = 1;
} else if (
  !(await runUsingResourceServer(
    $`pnpm tsx solana-example/server-express.ts`,
    runX402Payments,
  ))
) {
  ret = 1;
} else if (
  !(await runUsingResourceServer(
    $`pnpm tsx solana-example/server-mpp-hono.ts`,
    runMPPPayments,
  ))
) {
  ret = 1;
} else if (
  !(await runUsingResourceServer(
    $`pnpm tsx solana-example/server-dynamic-pricing-hono.ts`,
    runDynamicPricingPayments,
  ))
) {
  ret = 1;
}

echo("Killing off facilitator...");
void facilitator.nothrow(true);
await facilitator.kill();

process.exit(ret);
