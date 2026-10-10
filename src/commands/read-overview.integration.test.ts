import fs from "fs-extra";
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
import * as compactor from "../utils/compactor";
import * as readUtils from "../utils/read-utils";
import { NATIVE_HELP } from "../cli/help-native";

let fixture: WorkspaceFixture;
let exitCode: typeof process.exitCode;
beforeEach(async () => {
  exitCode = process.exitCode;
  process.exitCode = undefined;
  fixture = await createWorkspaceFixture();
  process.chdir(fixture.root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.cleanup();
  process.exitCode = exitCode;
});
async function invoke(
  transport: "cli" | "mcp",
  paths: string[],
  overview = true,
  allowance = 2000,
) {
  if (transport === "cli") {
    let text = "";
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        text += String(chunk);
        return true;
      });
    try {
      await dispatchCommand("read", [
        ...paths,
        ...(overview ? ["--overview"] : []),
        "--allowance",
        String(allowance),
      ]);
      return { text, rendered: text };
    } finally {
      spy.mockRestore();
    }
  }
  const result = await createToolRegistry({
    root: fixture.root,
  }).spekta_read.handler({ paths, overview, allowance }, undefined, "overview");
  return {
    text: result.content[0].text,
    rendered: serializeMcpToolReply("overview", result),
  };
}
const source =
  "export function answer() {\n  const omittedEvidence = 41;\n  return omittedEvidence + 1;\n}\n";
describe.each(["cli", "mcp"] as const)(
  "explicit structural overview over %s",
  (transport) => {
    it.each(["0", "999999"])(
      "is explicit regardless of threshold %s",
      async (threshold) => {
        process.env.SPEKTA_COMPACT_THRESHOLD = threshold;
        await fs.writeFile(path.join(fixture.root, "answer.ts"), source);
        expect((await invoke(transport, ["answer.ts"], false)).text).toContain(
          "const omittedEvidence",
        );
        const output = (await invoke(transport, ["answer.ts"])).text;
        expect(output).toContain("STRUCTURAL OVERVIEW");
        expect(output).toContain("[lines 2-3 collapsed]");
        expect(output).not.toContain("const omittedEvidence");
        expect(output).not.toContain("Full File");
        expect(output).toContain("omitted source evidence");
      },
    );
    it("falls back to complete original lines with continuation", async () => {
      const lines = Array.from(
        { length: 100 },
        (_, i) => `original evidence ${i + 1}`,
      );
      await fs.writeFile(
        path.join(fixture.root, "plain.txt"),
        lines.join("\n"),
      );
      const result = await invoke(transport, ["plain.txt"], true, 320);
      expect(result.text).toContain("ORIGINAL CONTENT");
      expect(result.text).not.toContain("STRUCTURAL OVERVIEW");
      expect(result.text).toContain("Next range: plain.txt[");
      const body = result.text
        .split("```txt\n")[1]
        .split("\n```")[0]
        .split("\n");
      expect(body).toEqual(lines.slice(0, body.length));
      expect(getTokenCount(result.rendered)).toBeLessThanOrEqual(320);
    });
    it("preserves ordinary read headings and labels empty fallback", async () => {
      await fs.writeFile(path.join(fixture.root, "answer.ts"), source);
      const ordinary = await invoke(transport, ["answer.ts"], false);
      expect(ordinary.text).toContain("(lines 1-4 (Full File))");
      await fs.writeFile(path.join(fixture.root, "empty.txt"), "");
      const empty = await invoke(transport, ["empty.txt"], true);
      expect(empty.text).toContain("original content; no lines; total 0");
      expect(empty.text).not.toContain("lines 1-0");
    });
    it("keeps fallback batches on original-line chunks", async () => {
      const lines = Array.from(
        { length: 1000 },
        (_, i) => `fallback evidence ${i + 1}`,
      );
      await fs.writeFile(
        path.join(fixture.root, "plain.txt"),
        lines.join("\n"),
      );
      await fs.writeFile(
        path.join(fixture.root, "small.txt"),
        "small original\n",
      );
      const result = await invoke(
        transport,
        ["plain.txt", "small.txt"],
        true,
        2000,
      );
      expect(result.text).toContain("ORIGINAL CONTENT FALLBACK");
      expect(result.text).toContain("No structural overview was available");
      expect(result.text).toContain("Next range: plain.txt[");
      expect(getTokenCount(result.rendered)).toBeLessThanOrEqual(2000);
    });
    it.each(["answer.ts[]", "answer.ts[1,$]", "answer.ts[2,3]"])(
      "rejects explicit range %s before retrieval",
      async (operand) => {
        const result = await invoke(transport, [operand], true, 80);
        expect(result.text).toContain("usage_error");
        expect(result.text).toContain("omit overview");
        expect(result.text).not.toContain("unavailable_access");
        expect(getTokenCount(result.rendered)).toBeLessThanOrEqual(80);
      },
    );
    it("preserves sibling outcomes and bounds indivisible overviews", async () => {
      await fs.writeFile(path.join(fixture.root, "answer.ts"), source);
      await fs.writeFile(
        path.join(fixture.root, "large.ts"),
        Array.from(
          { length: 1000 },
          (_, i) => `export const field${i} = ${i};`,
        ).join("\n") +
          "\n" +
          source,
      );
      const result = await invoke(
        transport,
        ["answer.ts", "large.ts", ".env"],
        true,
        2000,
      );
      expect(result.text).toContain("Operand 1: returned");
      expect(result.text).toContain("Operand 2: budget_limited");
      expect(result.text).toContain("Operand 3: unavailable");
      expect(result.text).not.toContain(".env");
      expect(result.text).not.toContain("Next range: large.ts");
      expect(getTokenCount(result.rendered)).toBeLessThanOrEqual(2000);
    });
    it("keeps eligible siblings when an overview compactor fails", async () => {
      await fs.writeFile(path.join(fixture.root, "answer.ts"), source);
      await fs.writeFile(path.join(fixture.root, "broken.ts"), source);
      const original = compactor.compactFile;
      vi.spyOn(compactor, "compactFile").mockImplementation(
        (file, content, start) => {
          if (file === "broken.ts") throw new Error("parser failure");
          return original(file, content, start);
        },
      );
      const result = await invoke(transport, ["answer.ts", "broken.ts"]);
      expect(result.text).toContain("Operand 1: returned");
      expect(result.text).toContain("Operand 2: internal_failure");
      expect(result.text).toContain("STRUCTURAL OVERVIEW");
      expect(getTokenCount(result.rendered)).toBeLessThanOrEqual(2000);
    });
    it("withholds an indivisible overview that cannot fit", async () => {
      const large = Array.from(
        { length: 120 },
        (_, i) =>
          `export function field${i}() {\n${Array.from({ length: 20 }, (_, j) => `  const item${j} = ${i + j};`).join("\n")}\n}`,
      ).join("\n");
      await fs.writeFile(path.join(fixture.root, "large.ts"), large);
      const result = await invoke(transport, ["large.ts"], true, 320);
      expect(result.text).toContain("indivisible");
      expect(result.text).toContain("omit --overview");
      expect(result.text).not.toContain("Next range:");
      expect(getTokenCount(result.rendered)).toBeLessThanOrEqual(320);
    });
  },
);
it("rejects malformed overview flags and MCP types", async () => {
  for (const args of [
    ["--overview"],
    ["answer.ts", "--overview=true"],
    ["answer.ts", "--overview", "--overview"],
  ]) {
    let output = "";
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        output += String(chunk);
        return true;
      });
    await dispatchCommand("read", args);
    spy.mockRestore();
    expect(output).toContain("usage_error");
  }
  const result = await createToolRegistry({
    root: fixture.root,
  }).spekta_read.handler({ paths: ["answer.ts"], overview: "true" });
  expect(result.content[0].text).toContain("usage_error");
});
it("advertises overview grammar and a boolean MCP parameter", () => {
  expect(NATIVE_HELP.read.usage.join("\n")).toContain("--overview");
  const help =
    NATIVE_HELP.read.sections?.flatMap((section) => section.lines).join("\n") ??
    "";
  expect(help).toContain("Cannot be combined with an explicit range");
  expect(help).toContain("explicit overviews");
  const schema = createToolRegistry({ root: fixture.root }).spekta_read.schema(
    {},
  );
  expect(
    schema.safeParse({ paths: ["answer.ts"], overview: true }).success,
  ).toBe(true);
  expect(
    schema.safeParse({ paths: ["answer.ts"], overview: "true" }).success,
  ).toBe(false);
});
it("bounds saved overview and fallback output, including the save notice", async () => {
  const previousNoEditor = process.env.SPEKTA_NO_EDITOR;
  process.env.SPEKTA_NO_EDITOR = "1";
  await fs.writeFile(path.join(fixture.root, "answer.ts"), source);
  await fs.writeFile(path.join(fixture.root, "plain.txt"), "plain fallback\n");
  for (const [file, overview] of [
    ["answer.ts", true],
    ["plain.txt", true],
  ] as const) {
    let output = "";
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        output += String(chunk);
        return true;
      });
    await dispatchCommand("read", [
      file,
      ...(overview ? ["--overview"] : []),
      "--save",
      "--allowance",
      "2000",
    ]);
    spy.mockRestore();
    const match = output.match(/Output saved to: (.+)\n$/);
    expect(match).toBeTruthy();
    const saved = await fs.readFile(match![1], "utf8");
    expect(output).toBe(`${saved}Output saved to: ${match![1]}\n`);
    expect(getTokenCount(output)).toBeLessThanOrEqual(2000);
    await fs.remove(match![1]);
  }
  if (previousNoEditor === undefined) delete process.env.SPEKTA_NO_EDITOR;
  else process.env.SPEKTA_NO_EDITOR = previousNoEditor;
});
it("continues fallback content with the original version marker", async () => {
  const lines = Array.from(
    { length: 100 },
    (_, i) => `continuation line ${i + 1}`,
  );
  await fs.writeFile(path.join(fixture.root, "plain.txt"), lines.join("\n"));
  const handler = createToolRegistry({ root: fixture.root }).spekta_read
    .handler;
  const first = await handler(
    { paths: ["plain.txt"], overview: true, allowance: 320 },
    undefined,
    "overview",
  );
  const next = first.content[0].text.match(
    /Next range: (plain\.txt\[\d+,\d+\])/,
  );
  const version = first.content[0].text.match(/\[Version: ([^\]]+)\]/)?.[1];
  expect(next).toBeTruthy();
  expect(version).toBeTruthy();
  const continued = await handler(
    { paths: [next![1]], expectedVersion: version, allowance: 320 },
    undefined,
    "overview",
  );
  const start = Number(next![1].match(/\[(\d+),/)?.[1]);
  const body = continued.content[0].text
    .split("```txt\n")[1]
    .split("\n```")[0]
    .split("\n");
  expect(body).toEqual(lines.slice(start - 1, start - 1 + body.length));
});
it("admits overview metadata before reading file content", async () => {
  for (const name of ["answer.ts", "second.ts", "third.ts"])
    await fs.writeFile(path.join(fixture.root, name), source);
  const readSpy = vi.spyOn(readUtils, "getVersionedFileLines");
  const result = await createToolRegistry({
    root: fixture.root,
  }).spekta_read.handler(
    {
      paths: ["answer.ts", "second.ts", "third.ts"],
      overview: true,
      allowance: 200,
    },
    undefined,
    "overview",
  );
  expect(result.content[0].text).toContain("output_limit_exceeded");
  expect(readSpy).not.toHaveBeenCalled();
});
