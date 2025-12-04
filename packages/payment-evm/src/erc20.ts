import { type PublicClient } from "viem";
import { type Address } from "@faremeter/types/evm";

export interface GetTokenBalanceArgs {
  account: Address;
  asset: Address;
  client: PublicClient;
}

export async function getTokenBalance(args: GetTokenBalanceArgs) {
  const { account, asset, client } = args;

  const [balance, decimals] = await client.multicall({
    contracts: [
      {
        address: asset,
        abi: [
          {
            name: "balanceOf",
            type: "function",
            stateMutability: "view",
            inputs: [{ type: "address" }],
            outputs: [{ type: "uint256" }],
          },
        ],
        functionName: "balanceOf",
        args: [account],
      },
      {
        address: asset,
        abi: [
          {
            name: "decimals",
            type: "function",
            stateMutability: "view",
            inputs: [],
            outputs: [{ type: "uint8" }],
          },
        ],
        functionName: "decimals",
        args: [],
      },
    ],
  });

  if (decimals.status !== "success" || balance.status !== "success") {
    throw new Error("failed to query balance");
  }

  return {
    amount: balance.result,
    decimals: decimals.result,
  };
}
