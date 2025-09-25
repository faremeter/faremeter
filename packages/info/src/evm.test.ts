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
    t.equal(info.forwarder, undefined);
    t.equal(info.forwarderName, undefined);
    t.equal(info.forwarderVersion, undefined);
    t.end();
  });
  await t.test((t) => {
    const info = evm.lookupKnownAsset("skale-europa-testnet", "USDC");

    if (!info) {
      throw new Error("failed to lookup known EVM asset");
    }

    t.matchOnly(info.address, "0x9eAb55199f4481eCD7659540A17Af618766b07C4");
    t.matchOnly(info.name, "USDC");
    t.matchOnly(info.network, "skale-europa-testnet");
    t.matchOnly(info.forwarder, "0x7779B0d1766e6305E5f8081E3C0CDF58FcA24330");
    t.matchOnly(info.forwarderName, "USDC Forwarder");
    t.matchOnly(info.forwarderVersion, "1");
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

  t.end();
});
