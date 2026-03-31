#!/usr/bin/env pnpm tsx

import t from "tap";
import { extractSpec } from "./parser";

await t.test("extractSpec extracts assets from document root", (t) => {
  const doc = {
    "x-faremeter-assets": {
      "usdc-sol": {
        chain: "solana:test",
        token: "TokenAddr",
        decimals: 6,
        recipient: "TestRecipient",
      },
    },
    "x-faremeter-pricing": { rates: { "usdc-sol": 1 } },
    paths: {},
  };

  const spec = extractSpec(doc);
  t.same(spec.assets, {
    "usdc-sol": {
      chain: "solana:test",
      token: "TokenAddr",
      decimals: 6,
      recipient: "TestRecipient",
    },
  });
  t.end();
});

await t.test("extractSpec resolves rates from document root", (t) => {
  const doc = {
    "x-faremeter-pricing": { rates: { "usdc-sol": 1 } },
    paths: {
      "/test": {
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "1" }],
          },
        },
      },
    },
  };

  const spec = extractSpec(doc);
  t.same(spec.operations["POST /test"]?.rates, { "usdc-sol": 1 });
  t.end();
});

await t.test("extractSpec path-level rates override document rates", (t) => {
  const doc = {
    "x-faremeter-pricing": { rates: { "usdc-sol": 1 } },
    paths: {
      "/test": {
        "x-faremeter-pricing": { rates: { "usdc-base": 2 } },
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "1" }],
          },
        },
      },
    },
  };

  const spec = extractSpec(doc);
  t.same(spec.operations["POST /test"]?.rates, { "usdc-base": 2 });
  t.end();
});

await t.test("extractSpec operation-level rates override path rates", (t) => {
  const doc = {
    "x-faremeter-pricing": { rates: { "usdc-sol": 1 } },
    paths: {
      "/test": {
        "x-faremeter-pricing": { rates: { "usdc-base": 2 } },
        post: {
          "x-faremeter-pricing": {
            rates: { "usdc-arb": 3 },
            rules: [{ match: "true", capture: "1" }],
          },
        },
      },
    },
  };

  const spec = extractSpec(doc);
  t.same(spec.operations["POST /test"]?.rates, { "usdc-arb": 3 });
  t.end();
});

await t.test(
  "operation with x-faremeter-pricing but no rules at any level is skipped",
  (t) => {
    // No rules at any level — the operation is not priced.
    const doc = {
      "x-faremeter-pricing": { rates: { "usdc-sol": 1 } },
      paths: {
        "/test": {
          post: {
            "x-faremeter-pricing": { rates: { "usdc-sol": 1 } },
          },
        },
      },
    };
    const spec = extractSpec(doc);
    t.equal(spec.operations["POST /test"], undefined);
    t.end();
  },
);

await t.test("extractSpec rejects fractional rates", (t) => {
  const doc = {
    "x-faremeter-pricing": { rates: { "usdc-sol": 0.5 } },
    paths: {
      "/test": {
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "1" }],
          },
        },
      },
    },
  };
  t.throws(() => extractSpec(doc), /rates\["usdc-sol"\]: must be an integer/);
  t.end();
});

await t.test("extractSpec rejects negative rates", (t) => {
  const doc = {
    "x-faremeter-pricing": { rates: { "usdc-sol": -1 } },
    paths: {
      "/test": {
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "1" }],
          },
        },
      },
    },
  };
  t.throws(() => extractSpec(doc), /rates\["usdc-sol"\]: must be non-negative/);
  t.end();
});

await t.test("extractSpec rejects non-numeric-string rates", (t) => {
  const doc = {
    "x-faremeter-pricing": { rates: { "usdc-sol": "not-a-number" } },
    paths: {
      "/test": {
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "1" }],
          },
        },
      },
    },
  };
  t.throws(() => extractSpec(doc), /rates\["usdc-sol"\]/);
  t.end();
});

await t.test(
  "extractSpec accepts integer numeric strings for large rates",
  (t) => {
    const doc = {
      "x-faremeter-pricing": { rates: { "usdc-sol": "9007199254740993" } },
      paths: {
        "/test": {
          post: {
            "x-faremeter-pricing": {
              rules: [{ match: "true", capture: "1" }],
            },
          },
        },
      },
    };
    const spec = extractSpec(doc);
    t.equal(
      spec.operations["POST /test"]?.rates?.["usdc-sol"],
      9007199254740993n,
    );
    t.end();
  },
);

await t.test("extractSpec rejects assets without recipient", (t) => {
  const doc = {
    "x-faremeter-assets": {
      "usdc-sol": {
        chain: "solana",
        token: "Token",
        decimals: 6,
        // recipient missing
      },
    },
    paths: {},
  };
  t.throws(() => extractSpec(doc), /recipient/);
  t.end();
});

await t.test("extractSpec handles multiple methods on the same path", (t) => {
  const doc = {
    "x-faremeter-pricing": { rates: { "usdc-sol": 1 } },
    paths: {
      "/test": {
        get: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "1" }],
          },
        },
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "2" }],
          },
        },
      },
    },
  };

  const spec = extractSpec(doc);
  t.ok(spec.operations["GET /test"]);
  t.ok(spec.operations["POST /test"]);
  t.equal(spec.operations["GET /test"]?.rules?.[0]?.capture, "1");
  t.equal(spec.operations["POST /test"]?.rules?.[0]?.capture, "2");
  t.end();
});

// -- Rules cascading --

const cascadeAssets = {
  "x-faremeter-assets": {
    usdc: { chain: "test", token: "T", decimals: 6, recipient: "R" },
  },
};

await t.test(
  "document-level rules cascade to operations with x-faremeter-pricing",
  (t) => {
    const doc = {
      ...cascadeAssets,
      "x-faremeter-pricing": {
        rates: { usdc: 1 },
        rules: [{ match: "$", capture: "100" }],
      },
      paths: {
        "/priced": {
          post: {
            "x-faremeter-pricing": {},
          },
        },
      },
    };
    const spec = extractSpec(doc);
    const op = spec.operations["POST /priced"];
    t.ok(op, "operation must be present");
    t.equal(op?.rules?.[0]?.capture, "100", "must inherit document rules");
    t.equal(op?.rates?.usdc, 1n, "must inherit document rates");
    t.end();
  },
);

await t.test(
  "path-level rules cascade to operations with x-faremeter-pricing",
  (t) => {
    const doc = {
      ...cascadeAssets,
      "x-faremeter-pricing": {
        rates: { usdc: 1 },
        rules: [{ match: "$", capture: "100" }],
      },
      paths: {
        "/special": {
          "x-faremeter-pricing": {
            rules: [{ match: "$", capture: "200" }],
          },
          post: {
            "x-faremeter-pricing": {},
          },
        },
      },
    };
    const spec = extractSpec(doc);
    const op = spec.operations["POST /special"];
    t.ok(op, "operation must be present");
    t.equal(
      op?.rules?.[0]?.capture,
      "200",
      "must inherit path rules, not document rules",
    );
    t.end();
  },
);

await t.test("operation-level rules override inherited rules", (t) => {
  const doc = {
    ...cascadeAssets,
    "x-faremeter-pricing": {
      rates: { usdc: 1 },
      rules: [{ match: "$", capture: "100" }],
    },
    paths: {
      "/override": {
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "$", capture: "500" }],
          },
        },
      },
    },
  };
  const spec = extractSpec(doc);
  t.equal(
    spec.operations["POST /override"]?.rules?.[0]?.capture,
    "500",
    "must use operation rules, not document rules",
  );
  t.end();
});

await t.test(
  "document-level rules apply to operations without x-faremeter-pricing",
  (t) => {
    const doc = {
      ...cascadeAssets,
      "x-faremeter-pricing": {
        rates: { usdc: 1 },
        rules: [{ match: "$", capture: "100" }],
      },
      paths: {
        "/health": {
          get: {
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const spec = extractSpec(doc);
    const op = spec.operations["GET /health"];
    t.ok(op, "operation must inherit document rules");
    t.equal(op?.rules?.[0]?.capture, "100");
    t.equal(op?.rates?.usdc, 1n);
    t.end();
  },
);

await t.test("explicit empty rules array opts out of inherited rules", (t) => {
  const doc = {
    ...cascadeAssets,
    "x-faremeter-pricing": {
      rates: { usdc: 1 },
      rules: [{ match: "$", capture: "100" }],
    },
    paths: {
      "/free": {
        post: {
          "x-faremeter-pricing": {
            rules: [],
          },
        },
      },
    },
  };
  const spec = extractSpec(doc);
  t.equal(
    spec.operations["POST /free"],
    undefined,
    "empty rules array must opt out of inherited rules",
  );
  t.end();
});
