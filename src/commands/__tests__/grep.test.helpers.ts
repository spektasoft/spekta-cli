import { Readable } from "node:stream";
import { vi } from "vitest";

export const createRgMatch = (
  file: string,
  line: number,
  col: number,
  text: string,
) => {
  return JSON.stringify({
    type: "match",
    data: {
      path: { text: file },
      line_number: line,
      submatches: [{ start: col }],
      lines: { text: text + "\n" },
    },
  });
};

export const mockExecaStream = (stdout: string, exitCode = 0) => {
  const promise =
    exitCode === 0
      ? Promise.resolve({ stdout, exitCode })
      : Promise.reject({ exitCode, message: "Command failed" });
  return Object.assign(promise, {
    stdout: Readable.from(stdout),
    kill: vi.fn(),
  }) as any;
};
