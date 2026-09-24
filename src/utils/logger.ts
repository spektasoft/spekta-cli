import { inspect } from "util";

export const Logger = {
  info: (msg: string, ...args: unknown[]) =>
    process.stdout.write(`[INFO] ${msg}${formatArgs(args)}\n`),
  warn: (msg: string, ...args: unknown[]) =>
    process.stdout.write(`[WARN] ${msg}${formatArgs(args)}\n`),
  error: (msg: string, ...args: unknown[]) =>
    process.stdout.write(`[ERROR] ${msg}${formatArgs(args)}\n`),
  log: (msg: string, ...args: unknown[]) =>
    process.stdout.write(`${msg}${formatArgs(args)}\n`),
};

function formatArgs(args: unknown[]): string {
  if (args.length === 0) return "";
  return (
    " " +
    args
      .map((arg) => {
        if (arg instanceof Error) {
          return arg.stack || arg.message;
        }
        if (typeof arg === "object" && arg !== null) {
          // colors: false ensures logs remain clean for all MCP clients
          return inspect(arg, { depth: 3, colors: false });
        }
        return String(arg);
      })
      .join(" ")
  );
}
