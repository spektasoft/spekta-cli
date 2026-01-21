export const Logger = {
  info: (msg: string) => process.stderr.write(`[INFO] ${msg}\n`),
  warn: (msg: string) => process.stderr.write(`[WARN] ${msg}\n`),
  error: (msg: string) => process.stderr.write(`[ERROR] ${msg}\n`),
  log: (msg: string) => process.stderr.write(`${msg}\n`),
};

