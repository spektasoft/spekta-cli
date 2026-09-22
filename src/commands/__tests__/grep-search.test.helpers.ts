import { Readable } from "node:stream";
import { execa } from "execa";
import { vi } from "vitest";

export class MockExecaError extends Error {
  exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "MockExecaError";
    this.exitCode = exitCode;
  }
}

export const createRgMatch = (
  file: string,
  line: number,
  col: number,
  text: string,
): string => {
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

export const mockExecaStream = (
  stdout: string,
  exitCode = 0,
): ReturnType<typeof execa> => {
  const promise =
    exitCode === 0
      ? Promise.resolve({ stdout, exitCode })
      : Promise.reject(new MockExecaError("Command failed", exitCode));
  return Object.assign(promise, {
    stdout: Readable.from(stdout),
    kill: vi.fn(),
  }) as unknown as ReturnType<typeof execa>;
};
