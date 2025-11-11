import "dotenv/config";
import { CrossmintWallets, createCrossmint } from "@crossmint/wallets-sdk";

// Address of your crossmint wallet
const apiKey = process.env.CROSSMINT_API_KEY!;

const crossmint = createCrossmint({
  apiKey,
});

const crossmintWallets = CrossmintWallets.from(crossmint);
const wallet = await crossmintWallets.createWallet({
  chain: "solana",
  signer: {
    type: "api-key",
  },
});

console.log(wallet);
