#!/usr/bin/env pnpm tsx

import t from "tap";
import * as evm from "./evm";

await t.test("basicNetworkLookup", async (t) => {
  t.ok(evm.isKnownNetwork("base"));
  t.ok(!evm.isKnownNetwork("asdkljas" as evm.KnownNetwork));
});

await t.test("basicAssetLookup", async (t) => {
  await t.test((t) => {
    const info = evm.lookupKnownAsset("base-sepolia", "USDC");

    if (!info) {
      throw new Error("failed to lookup known EVM asset");
    }

    t.matchOnly(info.address, "0x036cbd53842c5426634e7929541ec2318f3dcf7e");
    t.matchOnly(info.name, "USDC");
    t.matchOnly(info.network, "base-sepolia");
    t.end();
  });
  await t.test((t) => {
    const info = evm.lookupKnownAsset(
      "alsdkjaklsdj" as evm.KnownNetwork,
      "asldkjasd" as evm.KnownAsset,
    );

    t.matchOnly(info, undefined);
    t.end();
  });

  await t.test((t) => {
    t.ok(evm.isKnownAsset("USDC"));
    t.ok(!evm.isKnownAsset("notarealtoken" as evm.KnownAsset));
    t.end();
  });

  await t.test((t) => {
    const info = evm.lookupKnownAsset(84532, "USDC");

    if (!info) {
      throw new Error("failed to lookup known EVM asset");
    }

    t.matchOnly(info.address, "0x036cbd53842c5426634e7929541ec2318f3dcf7e");
    t.matchOnly(info.name, "USDC");
    t.matchOnly(info.network, "base-sepolia");
    t.end();
  });

  t.end();
});

await t.test("basicChainLookup", async (t) => {
  t.matchOnly(evm.lookupX402Network(8453), "base");
  t.matchOnly(evm.lookupX402Network(84532), "base-sepolia");
  t.matchOnly(evm.lookupX402Network(8675309), "eip155:8675309");
  t.end();
});
