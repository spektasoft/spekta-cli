import { beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "stream";
import { resolveCommandInput } from "./cli-input";
import { Logger } from "./logger";

vi.mock("./logger");

describe("resolveCommandInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
  });

  it("should fail and print usage if no arguments are provided", async () => {
    const result = await resolveCommandInput([], "Usage: test-usage");
    expect(result).toBeNull();
    expect(Logger.error).toHaveBeenCalledWith("Usage: test-usage");
    expect(process.exitCode).toBe(1);
  });

  it("should resolve content directly from arguments when provided", async () => {
    const result = await resolveCommandInput(
      ["target.txt", "line 1", "line 2"],
      "Usage: test-usage",
    );
    expect(result).toEqual({
      filePath: "target.txt",
      content: "line 1 line 2",
    });
    expect(process.exitCode).toBe(0);
  });

  it("should fail without hanging if only file path given in interactive TTY", async () => {
    vi.stubGlobal("process", {
      ...process,
      stdin: { isTTY: true },
      exitCode: 0,
    });

    const result = await resolveCommandInput(
      ["target.txt"],
      "Usage: test-usage",
    );
    expect(result).toBeNull();
    expect(Logger.error).toHaveBeenCalledWith("Usage: test-usage");
    expect(process.exitCode).toBe(1);

    vi.unstubAllGlobals();
  });

  it("should stream and resolve content from stdin when not in TTY mode", async () => {
    const content = "first line\nsecond line\n";
    const stdinMock = Readable.from([content]);
    Object.assign(stdinMock, { isTTY: false });

    vi.stubGlobal("process", {
      ...process,
      stdin: stdinMock,
      exitCode: 0,
    });

    const result = await resolveCommandInput(
      ["target.txt"],
      "Usage: test-usage",
    );
    expect(result).toEqual({
      filePath: "target.txt",
      content,
    });
    expect(process.exitCode).toBe(0);

    vi.unstubAllGlobals();
  });

  it("should report an error if stdin stream is empty", async () => {
    const stdinMock = Readable.from(["   \n  "]);
    Object.assign(stdinMock, { isTTY: false });

    vi.stubGlobal("process", {
      ...process,
      stdin: stdinMock,
      exitCode: 0,
    });

    const result = await resolveCommandInput(
      ["target.txt"],
      "Usage: test-usage",
    );
    expect(result).toBeNull();
    expect(Logger.error).toHaveBeenCalledWith("No content provided via stdin.");
    expect(process.exitCode).toBe(1);

    vi.unstubAllGlobals();
  });
});
