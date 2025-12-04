import type { Rpc } from "@solana/rpc";
import type { GetTokenAccountBalanceApi } from "@solana/rpc-api";
import { address } from "@solana/addresses";
import { Base58Address } from "@faremeter/types/solana";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

export interface GetTokenBalanceArgs {
  asset: Base58Address;
  account: Base58Address;
  rpcClient: Rpc<GetTokenAccountBalanceApi>;
}

// XXX - There has got to be a better way to do this.
export function isAccountNotFoundError(e: unknown) {
  if (!e || !(e instanceof Error)) {
    return false;
  }

  if (
    "name" in e &&
    (e.name === "TokenAccountNotFoundError" ||
      e.name === "AccountNotFoundError")
  ) {
    return true;
  }

  if ("message" in e && e.message.includes("could not find account")) {
    return true;
  }

  return false;
}

export async function getTokenBalance(args: GetTokenBalanceArgs) {
  const { asset, account, rpcClient } = args;

  const owner = address(account);
  const mint = address(asset);

  const [ata] = await findAssociatedTokenPda({
    mint,
    owner,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  let balanceInfo;

  try {
    balanceInfo = await rpcClient.getTokenAccountBalance(ata).send();
  } catch (e) {
    if (isAccountNotFoundError(e)) {
      return null;
    }

    throw e;
  }

  return {
    amount: BigInt(balanceInfo.value.amount),
    decimals: balanceInfo.value.decimals,
  };
}
