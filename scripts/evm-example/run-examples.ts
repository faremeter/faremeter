import { spinner, echo, $, type ProcessPromise } from "zx";
import { waitForHealth } from "../wait-for-health";

$.verbose = true;

const FACILITATOR_URL = "http://localhost:4000";
const RESOURCE_SERVER_URL = "http://localhost:4021";

async function runPayments() {
  await $`pnpm tsx evm-example/base-sepolia-payment.ts`;
  await $`pnpm tsx evm-example/ows-base-sepolia-payment.ts`;
  // XXX - Add the Ledger payment in future.
}

async function runUsingResourceServer(resourceServer: ProcessPromise) {
  let success = true;

  try {
    await spinner("Waiting for resource server health endpoint...", () =>
      waitForHealth(`${RESOURCE_SERVER_URL}/health`),
    );
    await runPayments();
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
  !(await runUsingResourceServer($`pnpm tsx evm-example/server-express.ts`))
) {
  ret = 1;
}

echo("Killing off facilitator...");
void facilitator.nothrow(true);
await facilitator.kill();

process.exit(ret);
