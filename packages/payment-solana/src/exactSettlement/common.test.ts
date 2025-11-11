#!/usr/bin/env pnpm tsx

import t from "tap";

import { isValidationError as iVE } from "@faremeter/types";
import { lookupKnownSPLToken } from "@faremeter/info/solana";
import { generateMatcher } from "./common";

await t.test("testBasicMatching", async (t) => {
  {
    const tokenInfo = lookupKnownSPLToken("mainnet-beta", "USDC");
    if (tokenInfo === undefined) {
      t.bailout("couldn't find SPL token");
      return;
    }

    const { matchTuple } = generateMatcher("mainnet-beta", tokenInfo.address);

    const req = {
      network: "solana-mainnet-beta",
      scheme: "exact",
      asset: tokenInfo.address,
    };

    t.ok(!iVE(matchTuple(req)));
    t.ok(
      !iVE(
        matchTuple({
          ...req,
          network: "solana",
        }),
      ),
    );

    t.ok(
      iVE(
        matchTuple({
          ...req,
          network: "foobar",
        }),
      ),
    );

    t.ok(
      iVE(
        matchTuple({
          ...req,
          scheme: "fner",
        }),
      ),
    );
  }

  t.end();
});
