import Eth from "@ledgerhq/hw-app-eth/lib-es/Eth";
import Solana from "@ledgerhq/hw-app-solana/lib-es/Solana";
import { PublicKey } from "@solana/web3.js";
import { createTransport, translateLedgerError } from "./transport";

function evmDerivationPath(index: number) {
  return `m/44'/60'/${index}'/0/0`;
}

function solanaDerivationPath(index: number) {
  return `44'/501'/${index}'`;
}

export async function selectLedgerAccount(
  type: "evm" | "solana",
  numAccounts = 5,
): Promise<{ path: string; address: string } | null> {
  const isEvm = type === "evm";
  console.log(
    `\nScanning first ${numAccounts} ${isEvm ? "Ethereum" : "Solana"} accounts...`,
  );

  const accounts: { path: string; address: string }[] = [];
  const transport = await createTransport();

  try {
    if (isEvm) {
      const eth = new Eth(transport);
      for (let i = 0; i < numAccounts; i++) {
        const path = evmDerivationPath(i);
        let result;
        try {
          result = await eth.getAddress(path, false);
        } catch (error) {
          throw translateLedgerError(error);
        }
        const address = result.address;
        const normalizedAddress = address.startsWith("0x")
          ? address
          : `0x${address}`;
        accounts.push({ path, address: normalizedAddress });
        console.log(`${i + 1}. ${normalizedAddress}`);
      }
    } else {
      const solana = new Solana(transport);
      for (let i = 0; i < numAccounts; i++) {
        const path = solanaDerivationPath(i);
        let result;
        try {
          result = await solana.getAddress(path, false);
        } catch (error) {
          throw translateLedgerError(error);
        }
        const publicKey = new PublicKey(result.address);
        const address = publicKey.toBase58();
        accounts.push({ path, address });
        console.log(`${i + 1}. ${address}`);
      }
    }
  } finally {
    await transport.close();
  }

  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const selection = await new Promise<string>((resolve) => {
    rl.question(`\nSelect account (1-${numAccounts}): `, resolve);
  });
  rl.close();

  const index = parseInt(selection) - 1;

  if (index < 0 || index >= accounts.length) {
    console.log("Invalid selection");
    return null;
  }

  return accounts[index] ?? null;
}
