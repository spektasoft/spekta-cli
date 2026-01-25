import { select } from "@inquirer/prompts";
import * as readline from "readline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEnv } from "../config";
import { openEditor } from "../editor-utils";
import { getTempPath } from "./fs-utils";
import { getUserMessage } from "./multiline-input";

vi.mock("readline");
vi.mock("@inquirer/prompts");
vi.mock("fs-extra");
vi.mock("../editor-utils");
vi.mock("../config");
vi.mock("./fs-utils");

describe("getUserMessage", () => {
  let mockRl: any;
  let consoleLogSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(getEnv).mockResolvedValue({ SPEKTA_EDITOR: "vim" } as any);
    vi.mocked(getTempPath).mockReturnValue("/tmp/test-path");

    mockRl = {
      question: vi.fn(),
      close: vi.fn(),
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRl);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return null when input is cancelled ('c')", async () => {
    mockRl.question.mockImplementationOnce(
      (prompt: string, cb: (answer: string) => void) => {
        cb("c");
      },
    );

    const result = await getUserMessage();
    expect(result).toBeNull();
    expect(mockRl.close).toHaveBeenCalled();
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

  it("should return null when 's' is pressed with no content", async () => {
    mockRl.question.mockImplementationOnce(
      (prompt: string, cb: (answer: string) => void) => {
        cb("s");
      },
    );

    const result = await getUserMessage();
    expect(result).toBeNull();
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
});
