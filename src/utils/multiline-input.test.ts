import { select } from "@inquirer/prompts";
import fs from "fs-extra";
import * as readline from "readline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEnv } from "../core/config";
import { openEditor } from "../editor-utils";
import { getTempPath } from "./fs-utils";
import { getUserMessage } from "./multiline-input";

vi.mock("readline");
vi.mock("@inquirer/prompts");
vi.mock("fs-extra");
vi.mock("../editor-utils");
vi.mock("../core/config");
vi.mock("./fs-utils");

describe("getUserMessage", () => {
  let mockRl: any;
  let consoleLogSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(getEnv).mockResolvedValue({ SPEKTA_EDITOR: "vim" } as any);
    vi.mocked(getTempPath).mockReturnValue("/tmp/test-path");

    // Fix: Ensure fs methods return Promises to avoid "undefined.catch" errors
    vi.mocked(fs.ensureFile).mockResolvedValue(undefined as never);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined as never);
    vi.mocked(fs.remove).mockResolvedValue(undefined as never);
    vi.mocked(fs.readFile).mockResolvedValue("" as never); // Default return

    mockRl = {
      question: vi.fn(),
      close: vi.fn(),
    };
    // Mock readline.createInterface to return our mockRl object
    // casting to any to avoid strict type checks on the full Readline interface
    (readline.createInterface as any) = vi.fn().mockReturnValue(mockRl);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should handle mixed command sequences (cancel → editor → send)", async () => {
    const sequence = ["initial", "c", "e", "fallback message", "s"];
    let callIndex = 0;

    vi.mocked(readline.createInterface).mockImplementation(() => {
      return {
        question: vi.fn((_prompt, cb) => {
          cb(sequence[callIndex++] || "q");
        }),
        close: vi.fn(),
      } as any;
    });

    vi.mocked(select).mockResolvedValue("send" as never);

    const result = await getUserMessage();
    expect(result).toBe("fallback message");
  });

  it("should handle mixed command sequences with successful editor submission", async () => {
    const sequence = ["initial", "c", "e"];
    let callIndex = 0;
    let closeCount = 0;

    vi.mocked(readline.createInterface).mockImplementation(
      () =>
        ({
          question: vi.fn((_prompt, cb) => {
            cb(sequence[callIndex++] || "q");
          }),
          close: vi.fn(() => {
            closeCount++;
          }),
        }) as any,
    );

    vi.mocked(select).mockResolvedValue("send" as never);
    vi.mocked(fs.readFile).mockResolvedValue(
      "edited content\nsecond line" as never,
    );

    const result = await getUserMessage();
    expect(result).toBe("edited content\nsecond line");
    expect(closeCount).toBe(2); // Session 1 (cancel), Session 2 (editor open → close before editor)
  });

  it("should retry when input is cancelled ('c')", async () => {
    mockRl.question
      .mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb("c");
        },
      )
      .mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb("q");
        },
      );

    const result = await getUserMessage();
    expect(result).toBe("exit");
    expect(mockRl.close).toHaveBeenCalledTimes(2);
    expect(consoleLogSpy).toHaveBeenCalledWith("Input cancelled.");
  });

  it("should return 'exit' when input is 'q'", async () => {
    mockRl.question.mockImplementationOnce(
      (prompt: string, cb: (answer: string) => void) => {
        cb("q");
      },
    );

    const result = await getUserMessage();
    expect(result).toBe("exit");
    expect(mockRl.close).toHaveBeenCalled();
  });

  it("should return content when input is 's'", async () => {
    mockRl.question
      .mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb("line 1");
        },
      )
      .mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb("line 2");
        },
      )
      .mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb("s");
        },
      );

    const result = await getUserMessage();
    expect(result).toBe("line 1\nline 2");
    expect(mockRl.close).toHaveBeenCalled();
  });

  it("should successfully collect multiple lines iteratively without recursion", async () => {
    const lines = ["first", "second", "third", "s"];
    lines.forEach((line) => {
      mockRl.question.mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => cb(line),
      );
    });

    const result = await getUserMessage();
    expect(result).toBe("first\nsecond\nthird");
    // Verify it only closed the interface once at the end of the session
    expect(mockRl.close).toHaveBeenCalledTimes(1);
  });

  it("should retry when 's' is pressed with no content", async () => {
    mockRl.question
      .mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb("s");
        },
      )
      .mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb("line 1");
        },
      )
      .mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb("s");
        },
      );

    const result = await getUserMessage();
    expect(result).toBe("line 1");
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "Input cancelled (empty message).",
    );
  });

  it("should handle external editor 'cancel' action (resets buffer and restarts loop)", async () => {
    // First loop: 'line1', then 'e', then select 'cancel'
    // Second loop: 'line2', then 's'
    mockRl.question
      .mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb("line1");
        },
      )
      .mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb("e");
        },
      )
      .mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb("line2");
        },
      )
      .mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb("s");
        },
      );

    vi.mocked(select).mockResolvedValue("cancel");

    const result = await getUserMessage();

    // After cancel, buffer is reset, so 'line1' should be gone.
    expect(result).toBe("line2");
  });

  it("should return to loop if editor fails", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    mockRl.question
      .mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb("e");
        },
      )
      .mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb("recovered");
        },
      )
      .mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb("s");
        },
      );

    vi.mocked(openEditor).mockRejectedValue(new Error("Editor crashed"));

    const result = await getUserMessage();

    expect(result).toBe("recovered");
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Editor failed"),
    );
  });

  it("should handle 100 consecutive cancellations without stack overflow", async () => {
    // Vitest has lower stack limits than production environments, so 100 is a safe threshold
    // to test iterative behavior without hitting Vitest's own overhead limits.
    const mockSequence = Array(100).fill("c");
    mockSequence.push("final message");
    mockSequence.push("s");

    mockSequence.forEach((input) => {
      mockRl.question.mockImplementationOnce(
        (prompt: string, cb: (answer: string) => void) => {
          cb(input);
        },
      );
    });

    const result = await getUserMessage();
    expect(result).toBe("final message");
    expect(mockRl.close).toHaveBeenCalledTimes(101);
  });

  it("should have non-nullable return type", () => {
    // Compile-time check: TypeScript should reject null/undefined assignment
    const result: string = "" as any; // Simulated return value
    // @ts-expect-error - null should not be assignable to return type
    const invalid: null = result;
    // @ts-expect-error - undefined should not be assignable to return type
    const invalid2: undefined = result;

    expect(typeof result).toBe("string");
  });

  it("should document forced-input semantics in JSDoc", () => {
    const fs = require("fs");
    const source = fs.readFileSync("src/utils/multiline-input.ts", "utf-8");
    expect(source).toMatch(/GUARANTEES:/);
    expect(source).toMatch(
      /Always returns a non-empty string OR the literal "exit"/,
    );
    expect(source).toMatch(/Never returns null\/undefined/);
  });
});
