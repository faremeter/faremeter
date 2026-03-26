import { isAddress, isHex } from "viem";
import type { Hex } from "viem";
import type { evm } from "@faremeter/types";
import {
  getWallet as getWalletOWS,
  signTypedData,
} from "@open-wallet-standard/core";
import type { OWSEvmWallet, OWSWalletOpts } from "./types";
import { logger } from "./logger";

/**
 * Creates an OWS-backed EVM wallet.
 *
 * Uses the Open Wallet Standard vault for EIP-712 typed data signing.
 * The passphrase is closed over and used for each signing operation.
 *
 * XXX - OWS signing calls are synchronous and block the event loop.
 * Consider wrapping in worker_threads if this becomes a bottleneck.
 *
 * @param chain - EVM chain configuration.
 * @param opts - OWS wallet options (wallet name/ID, passphrase, vault path).
 * @param getWallet - Optional wallet lookup function for testability.
 * @returns An EVM wallet that delegates signing to OWS.
 */
export function createOWSEvmWallet(
  chain: evm.ChainInfo,
  opts: OWSWalletOpts,
  getWallet: typeof getWalletOWS = getWalletOWS,
): OWSEvmWallet {
  const { walletNameOrId, passphrase, vaultPath } = opts;

  const walletInfo = getWallet(walletNameOrId, vaultPath);
  const evmAccount = walletInfo.accounts.find((a) =>
    a.chainId.startsWith("eip155"),
  );
  if (!evmAccount) {
    const msg = `No EVM account found in wallet "${walletNameOrId}"`;
    logger.error(msg);
    throw new Error(msg);
  }

  const raw = evmAccount.address.startsWith("0x")
    ? evmAccount.address
    : `0x${evmAccount.address}`;
  const address = raw.toLowerCase() as Hex;
  if (!isAddress(address)) {
    const msg = `Invalid EVM address in wallet "${walletNameOrId}": ${evmAccount.address}`;
    logger.error(msg);
    throw new Error(msg);
  }

  return {
    chain,
    address,
    account: {
      // XXX - OWS requires EIP712Domain to be explicitly included in
      // params.types. viem strips it before signing, so callers passing
      // typed data through viem must re-add EIP712Domain to the types
      // object before calling this method.
      signTypedData: async (params) => {
        const typedDataJSON = JSON.stringify({
          domain: params.domain,
          types: params.types,
          primaryType: params.primaryType,
          message: params.message,
        });

        const result = signTypedData(
          walletNameOrId,
          "ethereum",
          typedDataJSON,
          passphrase,
          undefined,
          vaultPath,
        );

        const sig = result.signature;
        const sigHex = sig.startsWith("0x") ? sig : `0x${sig}`;
        if (!isHex(sigHex) || sigHex.length < 4 || sigHex.length % 2 !== 0) {
          throw new Error(
            `OWS returned invalid hex signature: ${result.signature}`,
          );
        }
        return sigHex;
      },
    },
  };
}
