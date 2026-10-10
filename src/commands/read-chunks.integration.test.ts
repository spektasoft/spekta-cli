import fs from "fs-extra";
import { createReadStream } from "fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../__tests__/workspace-fixture";
import { dispatchCommand } from "../cli/commands";
import { createToolRegistry } from "../api/mcp-server/registry";
import { getTokenCount } from "../utils/read-utils";
import { serializeMcpToolReply } from "../__tests__/mcp-response-test-utils";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});

let fixture: WorkspaceFixture;
let exitCode: typeof process.exitCode;
beforeEach(async () => {
  exitCode = process.exitCode;
  fixture = await createWorkspaceFixture();
  process.chdir(fixture.root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.cleanup();
  process.exitCode = exitCode;
});

async function cli(args: string[]) {
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  await dispatchCommand("read", args);
  return output;
}

describe("original read chunks at public CLI/MCP boundaries", () => {
  it("returns original implementation lines even above the legacy compaction threshold", async () => {
    process.env.SPEKTA_COMPACT_THRESHOLD = "0";
    const source =
      "export function answer() {\n  const detail = 41;\n  return detail + 1;\n}\n";
    await fs.writeFile(path.join(fixture.root, "answer.ts"), source);
    const output = await cli(["answer.ts"]);
    expect(output).toContain(source);
    expect(output).not.toContain("COMPACT");
    const result = await createToolRegistry({
      root: fixture.root,
    }).spekta_read.handler({ paths: ["answer.ts"] });
    expect(result.content[0].text).toContain(source);
    expect(result.isError).toBeUndefined();
  });

  it("delivers complete contiguous Unicode lines with accurate coverage and a usable next range", async () => {
    process.env.SPEKTA_READ_TOKEN_LIMIT = "220";
    const lines = Array.from(
      { length: 40 },
      (_, i) => `line ${i + 1}: สวัสดี 🌏 café evidence`,
    );
    await fs.writeFile(path.join(fixture.root, "chunk.txt"), lines.join("\n"));
    const tools = createToolRegistry({ root: fixture.root });
    let start = 1;
    const delivered: string[] = [];
    while (start <= 40) {
      const requestId = "chunk-request";
      const result = await tools.spekta_read.handler(
        { paths: [`chunk.txt[${start},40]`] },
        undefined,
        requestId,
      );
      const output = result.content[0].text;
      expect(
        getTokenCount(serializeMcpToolReply(requestId, result)),
      ).toBeLessThanOrEqual(220);
      const coverage = output.match(/lines (\d+)-(\d+) of 40/);
      expect(coverage).not.toBeNull();
      const end = Number(coverage![2]);
      expect(Number(coverage![1])).toBe(start);
      const content = output.split("```txt\n")[1].split("\n```")[0];
      expect(content.split("\n")).toEqual(lines.slice(start - 1, end));
      delivered.push(...content.split("\n"));
      if (end < 40) {
        expect(result.isError).toBe(true);
        expect(output).toContain(`Next range: chunk.txt[${end + 1},40]`);
      } else expect(result.isError).toBeUndefined();
      start = end + 1;
    }
    expect(delivered).toEqual(lines);
  });

  it.each([
    ["", "edge.txt", "no lines; total 0", ""],
    ["one\ntwo\n", "edge.txt[2,99]", "lines 2-2 of 2", "two"],
    ["one\ntwo\n", "edge.txt[9,$]", "no lines; total 2", ""],
  ])(
    "reports actual EOF coverage for %s via %s",
    async (source, operand, coverage, content) => {
      await fs.writeFile(path.join(fixture.root, "edge.txt"), source);
      const output = await cli([operand]);
      expect(output).toContain(coverage);
      expect(output).toContain(`\n${content}\n\x60\x60\x60`);
      expect(process.exitCode).not.toBe(1);
    },
  );

  it("accepts an exact complete response budget and never shortens an oversized line", async () => {
    await fs.writeFile(
      path.join(fixture.root, "exact.txt"),
      "known evidence 🌏\n",
    );
    const tools = createToolRegistry({ root: fixture.root });
    const complete = await tools.spekta_read.handler(
      { paths: ["exact.txt"] },
      undefined,
      "exact",
    );
    const exactBudget = getTokenCount(serializeMcpToolReply("exact", complete));
    process.env.SPEKTA_READ_TOKEN_LIMIT = String(exactBudget);
    expect(
      await tools.spekta_read.handler(
        { paths: ["exact.txt"] },
        undefined,
        "exact",
      ),
    ).toEqual(complete);
    process.env.SPEKTA_READ_TOKEN_LIMIT = "180";
    await fs.writeFile(
      path.join(fixture.root, "oversized.txt"),
      "PRIVATE_LINE ".repeat(500),
    );
    const oversized = await tools.spekta_read.handler(
      { paths: ["oversized.txt"] },
      undefined,
      "oversized",
    );
    expect(oversized.isError).toBe(true);
    expect(oversized.content[0].text).toContain("output_limit_exceeded");
    expect(oversized.content[0].text).toContain("line 1");
    expect(oversized.content[0].text).toContain("SPEKTA_READ_TOKEN_LIMIT");
    expect(oversized.content[0].text).not.toContain("PRIVATE_LINE");
    expect(
      getTokenCount(serializeMcpToolReply("oversized", oversized)),
    ).toBeLessThanOrEqual(180);
  });

  it("rejects unsupported request grammar as usage errors before disclosing content", async () => {
    for (const operand of [
      "--unknown",
      "real.txt[0,2]",
      "real.txt[3,1]",
      "real.txt[$]",
    ]) {
      process.exitCode = undefined;
      const output = await cli(["real.txt", operand]);
      expect(process.exitCode).toBe(1);
      expect(output).toContain("usage_error");
      expect(output).not.toContain("INTERNAL");
      expect(output).not.toContain(operand);
      const result = await createToolRegistry({
        root: fixture.root,
      }).spekta_read.handler({ paths: ["real.txt", operand] });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("usage_error");
    }
    const tools = createToolRegistry({ root: fixture.root });
    for (const args of [
      {},
      { paths: "real.txt" },
      { paths: [] },
      { paths: ["real.txt"], unknown: true },
    ]) {
      const result = await tools.spekta_read.handler(args);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("usage_error");
    }
  });

  it("saves and prints the same complete-line chunk within the response budget", async () => {
    process.env.SPEKTA_READ_TOKEN_LIMIT = "200";
    await fs.writeFile(
      path.join(fixture.root, "saved.txt"),
      "complete saved evidence line\n".repeat(100),
    );
    const output = await cli(["saved.txt", "--save"]);
    expect(getTokenCount(output)).toBeLessThanOrEqual(200);
    const savedPath = output.match(/Output saved to: (.+)\n/)?.[1];
    expect(savedPath).toBeDefined();
    try {
      const saved = await fs.readFile(savedPath!, "utf8");
      expect(output).toBe(`${saved}Output saved to: ${savedPath}\n`);
      expect(saved).toContain("Next range: saved.txt[");
      expect(
        saved
          .split("```txt\n")[1]
          .split("\n```")[0]
          .split("\n")
          .every((line) => line === "complete saved evidence line"),
      ).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      if (savedPath) await fs.remove(savedPath);
    }
  });

  it("reports safe unavailable-access outcomes by operand position", async () => {
    const tools = createToolRegistry({ root: fixture.root });
    for (const operand of [
      ".env",
      "ignored.txt",
      "missing.txt",
      "external-file.txt",
    ]) {
      const result = await tools.spekta_read.handler({
        paths: ["real.txt", operand],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("unavailable_access");
      expect(result.content[0].text).toContain("Operand 2");
      expect(result.content[0].text).not.toContain(operand);
      expect(result.content[0].text).not.toContain("INTERNAL");
    }
    const output = await cli(["missing.txt"]);
    expect(output).toContain("unavailable_access");
    expect(output).not.toContain("missing.txt");
  });

  it("conceals filesystem diagnostics in internal-failure outcomes", async () => {
    vi.mocked(createReadStream).mockImplementationOnce(() => {
      throw new Error("PRIVATE_DIAGNOSTIC real.txt");
    });
    const result = await createToolRegistry({
      root: fixture.root,
    }).spekta_read.handler({ paths: ["real.txt"] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("internal_failure");
    expect(result.content[0].text).toContain("Operand 1");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_DIAGNOSTIC");
    expect(JSON.stringify(result)).not.toContain("real.txt");
  });
});
