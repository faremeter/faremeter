#!/usr/bin/env pnpm tsx

import t from "tap";
import type { TransactionError } from "@solana/rpc-types";
import { transactionErrorToString } from "./facilitator";

class MyBigCrazyError {
  someBigInt = 32n;
  someString = "a string";
  DuplicateInstruction = 42;
}

await t.test("transactionErrorToString", async (t) => {
  {
    const err = "AccountBorrowOutstanding" satisfies TransactionError;
    t.matchOnly(transactionErrorToString(err), "AccountBorrowOutstanding");
  }

  {
    const err = { DuplicateInstruction: 42 } satisfies TransactionError;
    t.matchOnly(transactionErrorToString(err), '{"DuplicateInstruction":42}');
  }

  {
    const err = {
      InstructionError: [32, "AccountBorrowFailed"],
    } satisfies TransactionError;
    t.matchOnly(
      transactionErrorToString(err),
      '{"InstructionError":[32,"AccountBorrowFailed"]}',
    );
  }

  {
    const err = {
      SomeResultThatShouldNeverHappen: 1337n,
    } as unknown as TransactionError;

    t.matchOnly(
      transactionErrorToString(err),
      '{"SomeResultThatShouldNeverHappen":"1337"}',
    );
  }

  {
    const err = 42 as unknown as TransactionError;
    t.matchOnly(transactionErrorToString(err), "42");
  }

  {
    const err = new MyBigCrazyError();
    t.matchOnly(
      transactionErrorToString(err),
      '{"someBigInt":"32","someString":"a string","DuplicateInstruction":42}',
    );
  }

  t.end();
});
