#!/usr/bin/env pnpm tsx

import t from "tap";
import * as solana from "./solana";

await t.test("basicClusterLookup", async (t) => {
  t.ok(solana.isKnownCluster("mainnet-beta"));
  t.ok(!solana.isKnownCluster("notacluster" as solana.KnownCluster));
  t.end();
});

await t.test("basicSPLTokenLookup", async (t) => {
  await t.test((t) => {
    const info = solana.lookupKnownSPLToken("devnet", "USDC");

    if (!info) {
      throw new Error("failed to lookup known SPL token");
    }

    t.matchOnly(info.address, "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    t.matchOnly(info.cluster, "devnet");
    t.end();
  });
  await t.test((t) => {
    const info = solana.lookupKnownSPLToken(
      "alsdkjaklsdj" as solana.KnownCluster,
      "asldkjasd" as solana.KnownSPLToken,
    );

    t.matchOnly(info, undefined);
    t.end();
  });

  await t.test((t) => {
    t.ok(solana.isKnownSPLToken("USDC"));
    t.ok(!solana.isKnownSPLToken("notarealtoken" as solana.KnownSPLToken));
    t.end();
  });

  t.end();
});
