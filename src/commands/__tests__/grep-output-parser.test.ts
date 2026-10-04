import { beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import {
  getGrepResponseTokenCount,
  parseGrepOutput,
} from "../grep-output-parser";
import { getTokenCount } from "../../utils/read-utils";
import { createRgMatch, mockExecaStream } from "./grep-search.test.helpers";

vi.mock("../../core/config", () => ({
  getGrepTokenLimit: vi.fn().mockReturnValue(2000),
}));
import { getGrepTokenLimit } from "../../core/config";
vi.mock("../../utils/path-ignore", () => ({
  isPathIgnored: vi.fn().mockResolvedValue(false),
}));

beforeEach(() => vi.mocked(getGrepTokenLimit).mockReturnValue(2000));

describe("parseGrepOutput", () => {
  it("formats ripgrep match lines into markdown blocks", async () => {
    const matchLine = createRgMatch("src/index.ts", 12, 4, "const val = 1;");
    const child = mockExecaStream(matchLine);

    const result = await parseGrepOutput(child);

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.value).toContain("#### src/index.ts");
    expect(result.value).toContain("```ts\n12:4:const val = 1;\n```");
    expect(getGrepResponseTokenCount(result.value)).toBeLessThanOrEqual(2000);
  });

  it("reports safe process metadata when child process fails", async () => {
    const child = mockExecaStream("", 2);

    const outcome = await parseGrepOutput(child);
    expect(outcome.status).toBe("engine_failure");
    if (outcome.status !== "engine_failure") return;
    expect(outcome.message).toBe(
      "Ripgrep error: Search process failed (exit code 2).",
    );
    expect(getGrepResponseTokenCount(outcome.message)).toBeLessThanOrEqual(
      2000,
    );
  });

  it("keeps independent child failures distinct after a ceiling cancels the search", async () => {
    const stdout = Array.from({ length: 501 }, (_, index) =>
      createRgMatch("many.ts", index + 1, 0, `needle ${index}`),
    ).join("\n");
    const failure = Object.assign(new Error("independent process failure"), {
      exitCode: 2,
    });
    const child = Object.assign(Promise.reject(failure), {
      stdout: Readable.from(stdout),
      kill: vi.fn(),
    });

    const outcome = await parseGrepOutput(child);

    expect(child.kill).toHaveBeenCalledOnce();
    expect(outcome).toEqual({
      status: "engine_failure",
      message: "Ripgrep error: Search process failed (exit code 2).",
    });
  });

  it("does not expose Execa buffered output in an independent failure diagnostic", async () => {
    const secretMatch = createRgMatch("private.ts", 1, 0, "WITHHELD_SECRET");
    const streamedMatches = Array.from({ length: 101 }, (_, index) =>
      createRgMatch(`private-${index}.ts`, 1, 0, `needle ${index}`),
    ).join("\n");
    const failure = Object.assign(
      new Error("Command failed with output: WITHHELD_SECRET"),
      {
        exitCode: 2,
        stdout: secretMatch,
        stderr: "diagnostic stderr",
      },
    );
    const child = Object.assign(Promise.reject(failure), {
      stdout: Readable.from(streamedMatches),
      kill: vi.fn(),
    });

    const outcome = await parseGrepOutput(child);

    expect(outcome.status).toBe("engine_failure");
    if (outcome.status !== "engine_failure") return;
    expect(outcome.message).not.toContain("WITHHELD_SECRET");
    expect(outcome.message).not.toContain("private.ts");
    expect(outcome.message).toContain("exit code 2");
  });

  it("treats the expected termination signal as intentional ceiling cancellation", async () => {
    const stdout = Array.from({ length: 501 }, (_, index) =>
      createRgMatch("many.ts", index + 1, 0, `needle ${index}`),
    ).join("\n");
    const cancellation = Object.assign(new Error("Command was killed"), {
      exitCode: null,
      signal: "SIGTERM",
    });
    const child = Object.assign(Promise.reject(cancellation), {
      stdout: Readable.from(stdout),
      kill: vi.fn(),
    });

    await expect(parseGrepOutput(child)).resolves.toMatchObject({
      status: "output_limit_exceeded",
    });
  });

  it("bounds no-match and narrowing guidance, including the MCP envelope", async () => {
    const noMatches = await parseGrepOutput(mockExecaStream(""));
    expect(noMatches.status).toBe("no_matches");
    if (noMatches.status !== "no_matches") return;
    expect(getGrepResponseTokenCount(noMatches.message)).toBeLessThanOrEqual(
      2000,
    );
    const sdkSerializedResponse = `${JSON.stringify({
      result: { content: [{ type: "text", text: "No matches found." }] },
      jsonrpc: "2.0",
      id: 0,
    })}\n`;
    const sdkTokenCount = getTokenCount(sdkSerializedResponse);
    expect(sdkTokenCount).toBe(30);
    expect(getGrepResponseTokenCount("No matches found.", 0)).toBe(
      sdkTokenCount,
    );

    vi.mocked(getGrepTokenLimit).mockReturnValue(33);
    const bounded = await parseGrepOutput(mockExecaStream(""), {
      workspace: { root: "/repo", canonicalRoot: "/repo" },
      canonicalSearchPath: "/repo",
      requestedSearchPath: ".",
      responseId: 0,
    });
    expect(bounded.status).toBe("no_matches");
    if (bounded.status !== "no_matches") return;
    expect(bounded.message).toBe("No matches found.");
    expect(bounded.message).toMatch(/no match/i);
    expect(getGrepResponseTokenCount(bounded.message, 0)).toBeLessThanOrEqual(
      33,
    );

    const engineFailure = await parseGrepOutput(mockExecaStream("", 2), {
      workspace: { root: "/repo", canonicalRoot: "/repo" },
      canonicalSearchPath: "/repo",
      requestedSearchPath: ".",
      responseId: 0,
    });
    expect(engineFailure.status).toBe("engine_failure");
    if (engineFailure.status !== "engine_failure") return;
    expect(engineFailure.message).toMatch(/fail|error/i);
    expect(
      getGrepResponseTokenCount(engineFailure.message, 0, true),
    ).toBeLessThanOrEqual(33);

    vi.mocked(getGrepTokenLimit).mockReturnValue(33);
    const limited = await parseGrepOutput(
      mockExecaStream(createRgMatch("large.ts", 1, 0, "needle")),
      {
        workspace: { root: "/repo", canonicalRoot: "/repo" },
        canonicalSearchPath: "/repo",
        requestedSearchPath: ".",
        responseId: 0,
      },
    );
    expect(limited.status).toBe("output_limit_exceeded");
    if (limited.status !== "output_limit_exceeded") return;
    expect(limited.message).toMatch(/withheld/i);
    expect(limited.message).toMatch(/narrow/i);
    expect(getGrepResponseTokenCount(limited.message, 0)).toBeLessThanOrEqual(
      33,
    );

    const emptyEnvelopeBudget = getGrepResponseTokenCount("", 0);
    vi.mocked(getGrepTokenLimit).mockReturnValue(emptyEnvelopeBudget);
    const tiny = await parseGrepOutput(mockExecaStream(""), {
      workspace: { root: "/repo", canonicalRoot: "/repo" },
      canonicalSearchPath: "/repo",
      requestedSearchPath: ".",
      responseId: 0,
    });
    expect(tiny.status).toBe("no_matches");
    if (tiny.status !== "no_matches") return;
    expect(tiny.message).toBe("");
    expect(getGrepResponseTokenCount(tiny.message, 0)).toBeLessThanOrEqual(
      emptyEnvelopeBudget,
    );

    const longRequestId = `request-${"x".repeat(120)}`;
    const longIdEnvelopeBudget = getGrepResponseTokenCount("", longRequestId);
    vi.mocked(getGrepTokenLimit).mockReturnValue(longIdEnvelopeBudget);
    const longIdTiny = await parseGrepOutput(mockExecaStream(""), {
      workspace: { root: "/repo", canonicalRoot: "/repo" },
      canonicalSearchPath: "/repo",
      requestedSearchPath: ".",
      responseId: longRequestId,
    });
    expect(longIdTiny.status).toBe("no_matches");
    if (longIdTiny.status !== "no_matches") return;
    expect(longIdTiny.message).toBe("");
    expect(
      getGrepResponseTokenCount(longIdTiny.message, longRequestId),
    ).toBeLessThanOrEqual(longIdEnvelopeBudget);
  });

  it("keeps an exact-fit CLI no-match message without counting an error prefix", async () => {
    vi.mocked(getGrepTokenLimit).mockReturnValue(4);

    const outcome = await parseGrepOutput(mockExecaStream(""));

    expect(outcome).toEqual({
      status: "no_matches",
      message: "No matches found.",
    });
    expect(
      getTokenCount(
        `${outcome.status === "no_matches" ? outcome.message : ""}\n`,
      ),
    ).toBe(4);
  });
});
