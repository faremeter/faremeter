import type { UserInterface } from "./types";

export type createReadlineInterfaceArgs = {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
};

export async function createReadlineInterface(
  args: createReadlineInterfaceArgs,
) {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: args.stdin,
    output: args.stdout,
  });

  return {
    message: (msg: string) => void args.stdout.write(msg + "\n"),
    question: async (q: string) =>
      new Promise<string>((resolve) => {
        rl.question(q, resolve);
      }),
    close: async () => rl.close(),
  } satisfies UserInterface;
}
