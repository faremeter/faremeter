import type { Provider } from "@coral-xyz/anchor";
import type { Connection } from "@solana/web3.js";

export class DummyProvider implements Provider {
  public get connection(): Connection {
    throw new Error("anchor requested a connection");
  }
}
