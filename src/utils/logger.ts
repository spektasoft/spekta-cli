import { inspect } from "util";

export const Logger = {
  info: (msg: string, ...args: any[]) =>
    process.stderr.write(`[INFO] ${msg}${formatArgs(args)}\n`),
  warn: (msg: string, ...args: any[]) =>
    process.stderr.write(`[WARN] ${msg}${formatArgs(args)}\n`),
  error: (msg: string, ...args: any[]) =>
    process.stderr.write(`[ERROR] ${msg}${formatArgs(args)}\n`),
  log: (msg: string, ...args: any[]) =>
    process.stderr.write(`${msg}${formatArgs(args)}\n`),
};

function formatArgs(args: any[]): string {
  if (args.length === 0) return "";
  return (
    " " +
    args
      .map((arg) => {
        if (arg instanceof Error) {
          return arg.stack || arg.message;
        }
        if (typeof arg === "object") {
          return inspect(arg, { depth: 2, colors: true });
        }
        return String(arg);
      })
      .join(" ")
  );
}
