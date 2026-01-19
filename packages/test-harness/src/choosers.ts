/* eslint-disable @typescript-eslint/no-deprecated -- v1 test harness uses v1 types */
import type { PaymentExecerV1 } from "@faremeter/types/client";

export function chooseFirst(execers: PaymentExecerV1[]): PaymentExecerV1 {
  if (execers.length === 0) {
    throw new Error("No payment options available");
  }
  const first = execers[0];
  if (!first) {
    throw new Error("No payment options available");
  }
  return first;
}

export function chooseCheapest(execers: PaymentExecerV1[]): PaymentExecerV1 {
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

export function chooseMostExpensive(
  execers: PaymentExecerV1[],
): PaymentExecerV1 {
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
): (execers: PaymentExecerV1[]) => PaymentExecerV1 {
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
): (execers: PaymentExecerV1[]) => PaymentExecerV1 {
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
): (execers: PaymentExecerV1[]) => PaymentExecerV1 {
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
): (execers: PaymentExecerV1[]) => PaymentExecerV1 {
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
  inspector: (execers: PaymentExecerV1[]) => void,
  inner: (execers: PaymentExecerV1[]) => PaymentExecerV1,
): (execers: PaymentExecerV1[]) => PaymentExecerV1 {
  return (execers) => {
    inspector(execers);
    return inner(execers);
  };
}

export function chooseWithFilter(
  filter: (execer: PaymentExecerV1) => boolean,
  inner: (execers: PaymentExecerV1[]) => PaymentExecerV1,
): (execers: PaymentExecerV1[]) => PaymentExecerV1 {
  return (execers) => {
    const filtered = execers.filter(filter);
    return inner(filtered);
  };
}
