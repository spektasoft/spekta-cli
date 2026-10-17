import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRg } from "../rg";
import { Logger } from "../../utils/logger";
import * as grepSearch from "../grep-search";
import { createSearchLifecycle } from "../grep-search";
import { getRgOutcome, SEARCH_DEADLINE_MS } from "../grep-search";

describe("runRg", () => {
  beforeEach(() => {
    vi.spyOn(Logger, "error").mockReturnValue(true);
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    process.exitCode = 0;
  });

  it("supports a finite experimental deadline override from the CLI", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome").mockResolvedValue({
      status: "no_matches",
      message: "No matches found.",
    });
    await runRg(["--deadline-ms", "1250", "needle"]);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ deadlineMs: 1250 }),
    );
    expect(SEARCH_DEADLINE_MS).toBe(30_000);
  });

  it("returns a distinct cancellation outcome before preparation starts", async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await getRgOutcome({
      patterns: ["needle"],
      paths: ["."],
      globs: [],
      case_mode: "sensitive",
      signal: controller.signal,
    });
    expect(outcome.status).toBe("cancelled");
    expect(outcome.status === "cancelled" && outcome.message).toContain(
      "no complete results",
    );
  });

  it("aborts the lifecycle at its configured deadline", () => {
    vi.useFakeTimers();
    const lifecycle = createSearchLifecycle(
      undefined,
      Date.now,
      setTimeout,
      clearTimeout,
      undefined,
      25,
    );
    vi.advanceTimersByTime(25);
    expect(lifecycle.signal.aborted).toBe(true);
    expect(lifecycle.getTermination()).toBe("deadline_exceeded");
    lifecycle.finish();
  });

  it("uses one pattern, an optional path, and case-sensitive matching by default", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome").mockResolvedValue({
      status: "success",
      value: "matches",
    });

    await runRg(["needle", "nested"]);

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        patterns: ["needle"],
        paths: ["nested"],
        globs: [],
        case_mode: "sensitive",
      }),
    );
  });

  it("defaults the path to the workspace root", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome").mockResolvedValue({
      status: "no_matches",
      message: "No matches found.",
    });

    await runRg(["needle"]);

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        patterns: ["needle"],
        paths: [],
        globs: [],
        case_mode: "sensitive",
      }),
    );
  });

  it("uses repeated regexp options as alternatives and keeps positional operands as separate paths", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome").mockResolvedValue({
      status: "no_matches",
      message: "No matches found.",
    });
    await runRg(["src", "-e", "first", "--regexp=second", "docs"]);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        patterns: ["first", "second"],
        paths: ["src", "docs"],
        globs: [],
        case_mode: "sensitive",
      }),
    );
  });

  it("parses native case flags with the last selected mode taking precedence", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome").mockResolvedValue({
      status: "no_matches",
      message: "No matches found.",
    });
    await runRg(["-i", "-S", "-s", "needle"]);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        patterns: ["needle"],
        paths: [],
        globs: [],
        case_mode: "sensitive",
      }),
    );
  });

  it("preserves repeated glob filters and comma-containing values", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome").mockResolvedValue({
      status: "no_matches",
      message: "No matches found.",
    });
    await runRg(["-g", "*.ts,*.tsx", "--glob=!*.test.ts", "needle"]);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        patterns: ["needle"],
        paths: [],
        globs: ["*.ts,*.tsx", "!*.test.ts"],
        case_mode: "sensitive",
      }),
    );
  });

  it("rejects missing case and glob values", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome");
    await runRg(["needle", "-g"]);
    expect(search).not.toHaveBeenCalled();
    expect(Logger.error).toHaveBeenCalledWith(
      "usage_error: Option -g requires a glob.",
    );

    await runRg(["needle", "--glob="]);
    expect(search).not.toHaveBeenCalled();
    expect(Logger.error).toHaveBeenCalledWith(
      "usage_error: Option --glob requires a glob.",
    );
  });

  it("accepts dash-prefixed patterns and paths after the option terminator", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome").mockResolvedValue({
      status: "no_matches",
      message: "No matches found.",
    });
    await runRg(["--", "-pattern", "-directory"]);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        patterns: ["-pattern"],
        paths: ["-directory"],
        globs: [],
        case_mode: "sensitive",
      }),
    );
  });

  it("rejects unsupported options before searching", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome");
    await runRg(["--json"]);
    expect(search).not.toHaveBeenCalled();
    expect(Logger.error).toHaveBeenCalledWith(
      "usage_error: Unsupported ripgrep option.",
    );
  });

  it("parses one allowance before -- and rejects malformed or repeated values before searching", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome").mockResolvedValue({
      status: "no_matches",
      message: "no_matches: No matches found.",
    });
    await runRg(["--allowance=1200", "-e", "needle", "--", "-literal"]);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        patterns: ["needle"],
        paths: ["-literal"],
        globs: [],
        case_mode: "sensitive",
        allowance: "1200",
      }),
    );

    search.mockClear();
    await runRg(["needle", "--allowance"]);
    expect(search).not.toHaveBeenCalled();
    expect(Logger.error).toHaveBeenCalledWith(
      "usage_error: --allowance requires a positive whole number.",
    );
    await runRg(["--allowance", "100", "--allowance=200", "needle"]);
    expect(search).not.toHaveBeenCalled();
    expect(Logger.error).toHaveBeenCalledWith(
      "usage_error: --allowance may be specified only once.",
    );
    await runRg(["needle", "--allowance=1.5"]);
    expect(search).toHaveBeenCalledOnce();
  });

  it("passes standard input paths to the search policy for explicit rejection", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome").mockResolvedValue({
      status: "policy_rejection",
      message: "Standard input search paths are not supported.",
    });
    await runRg(["-e", "needle", "--", "-"]);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        patterns: ["needle"],
        paths: ["-"],
        globs: [],
        case_mode: "sensitive",
      }),
    );
  });

  it("keeps progress on stderr and final failures off stdout", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const search = vi.spyOn(grepSearch, "getRgOutcome");
    search.mockImplementation((request) => {
      request.onProgress?.("preparing");
      request.onProgress?.("searching");
      return Promise.resolve({
        status: "engine_failure",
        message: "internal_failure: Search failed.",
      });
    });

    await runRg(["--profile", "needle"]);

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        patterns: ["needle"],
        profile: true,
      }),
    );
    expect(search.mock.calls[0]?.[0].onProgress).toBeTypeOf("function");
    expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join("")).toBe(
      "Search preparing.\nSearch searching.\n",
    );
    expect(stdout).not.toHaveBeenCalled();
    expect(Logger.error).toHaveBeenCalledWith(
      "internal_failure: Search failed.",
    );
  });

  it("reports delayed CLI progress on stderr and keeps stdout for the final result", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.spyOn(grepSearch, "getRgOutcome").mockImplementation(async (request) => {
      const lifecycle = createSearchLifecycle(request.onProgress, () =>
        Date.now(),
      );
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 3000));
        lifecycle.setPhase("searching");
        return { status: "success", value: "success: final matches" };
      } finally {
        lifecycle.finish();
      }
    });

    const run = runRg(["needle"]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join("")).toBe(
      "Search preparing.\n",
    );
    await vi.advanceTimersByTimeAsync(1000);
    await run;
    expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join("")).toBe(
      "Search preparing.\nSearch searching.\n",
    );
    expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join("")).toBe(
      "success: final matches\n",
    );
  });

  it("emits no CLI progress for a fast search", async () => {
    vi.useFakeTimers();
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.spyOn(grepSearch, "getRgOutcome").mockImplementation((request) => {
      createSearchLifecycle(request.onProgress).finish();
      return Promise.resolve({
        status: "no_matches",
        message: "no_matches: none",
      });
    });
    await runRg(["needle"]);
    expect(stderr).not.toHaveBeenCalled();
  });
});
