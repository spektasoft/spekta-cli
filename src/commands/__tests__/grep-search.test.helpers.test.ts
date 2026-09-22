import { describe, expect, it } from "vitest";
import {
  createRgMatch,
  mockExecaStream,
  MockExecaError,
} from "./grep-search.test.helpers";

interface RipgrepMatchData {
  type: string;
  data: {
    path: { text: string };
    lines: { text: string };
  };
}

describe("grep-search.test.helpers", () => {
  it("generates a valid ripgrep match JSON string", () => {
    const json = createRgMatch("test.ts", 1, 5, "content");
    const parsed = JSON.parse(json) as unknown as RipgrepMatchData;
    expect(parsed.type).toBe("match");
    expect(parsed.data.path.text).toBe("test.ts");
    expect(parsed.data.lines.text).toBe("content\n");
  });

  it("creates a mock execa process with stream and exit code", async () => {
    const mock = mockExecaStream("output");
    expect(mock.stdout).toBeDefined();
    await expect(mock).resolves.toEqual({ stdout: "output", exitCode: 0 });
  });

  it("creates a failing mock execa process rejecting with MockExecaError", async () => {
    const mock = mockExecaStream("", 1);
    await expect(mock).rejects.toBeInstanceOf(MockExecaError);
  });
});
