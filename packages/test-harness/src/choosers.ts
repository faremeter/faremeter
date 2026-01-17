import type { PaymentExecer } from "@faremeter/types/client";

export function chooseFirst(execers: PaymentExecer[]): PaymentExecer {
  if (execers.length === 0) {
    throw new Error("No payment options available");
  }
  const first = execers[0];
  if (!first) {
    throw new Error("No payment options available");
  }
  return first;
}

export function chooseCheapest(execers: PaymentExecer[]): PaymentExecer {
  if (execers.length === 0) {
    throw new Error("No payment options available");
  }
  return execers.reduce((cheapest, current) =>
    BigInt(current.requirements.maxAmountRequired) <
    BigInt(cheapest.requirements.maxAmountRequired)
      ? current
      : cheapest,
  );
}

export function chooseMostExpensive(execers: PaymentExecer[]): PaymentExecer {
  if (execers.length === 0) {
    throw new Error("No payment options available");
  }
  return execers.reduce((expensive, current) =>
    BigInt(current.requirements.maxAmountRequired) >
    BigInt(expensive.requirements.maxAmountRequired)
      ? current
      : expensive,
  );
}

export function chooseByAsset(
  asset: string,
): (execers: PaymentExecer[]) => PaymentExecer {
  return (execers) => {
    const match = execers.find(
      (e) => e.requirements.asset.toLowerCase() === asset.toLowerCase(),
    );
    if (!match) {
      throw new Error(`No payment option for asset: ${asset}`);
    }
    return match;
  };
}

export function chooseByNetwork(
  network: string,
): (execers: PaymentExecer[]) => PaymentExecer {
  return (execers) => {
    const match = execers.find(
      (e) => e.requirements.network.toLowerCase() === network.toLowerCase(),
    );
    if (!match) {
      throw new Error(`No payment option for network: ${network}`);
    }
    return match;
  };
}

export function chooseByScheme(
  scheme: string,
): (execers: PaymentExecer[]) => PaymentExecer {
  return (execers) => {
    const match = execers.find(
      (e) => e.requirements.scheme.toLowerCase() === scheme.toLowerCase(),
    );
    if (!match) {
      throw new Error(`No payment option for scheme: ${scheme}`);
    }
    return match;
  };
}

export function chooseByIndex(
  index: number,
): (execers: PaymentExecer[]) => PaymentExecer {
  return (execers) => {
    const execer = execers[index];
    if (!execer) {
      throw new Error(
        `Index ${index} out of bounds (${execers.length} options available)`,
      );
    }
    return execer;
  };
}

export function chooseNone(): never {
  throw new Error("No suitable payment option");
}

export function chooseWithInspection(
  inspector: (execers: PaymentExecer[]) => void,
  inner: (execers: PaymentExecer[]) => PaymentExecer,
): (execers: PaymentExecer[]) => PaymentExecer {
  return (execers) => {
    inspector(execers);
    return inner(execers);
  };
}

export function chooseWithFilter(
  filter: (execer: PaymentExecer) => boolean,
  inner: (execers: PaymentExecer[]) => PaymentExecer,
): (execers: PaymentExecer[]) => PaymentExecer {
  return (execers) => {
    const filtered = execers.filter(filter);
    return inner(filtered);
  };
}
