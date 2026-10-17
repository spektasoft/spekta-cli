import fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "../cli/commands";
import { createToolRegistry } from "../api/mcp-server/registry";
import { serializeMcpToolReply } from "../__tests__/mcp-response-test-utils";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../__tests__/workspace-fixture";
import { getTokenCount } from "../utils/read-utils";
import * as readUtils from "../utils/read-utils";
import { NATIVE_HELP } from "../cli/help-native";
import { renderTopic } from "../cli/help-topic";

let fixture: WorkspaceFixture;
let savedExitCode: typeof process.exitCode;

beforeEach(async () => {
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
  fixture = await createWorkspaceFixture();
  process.chdir(fixture.root);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.cleanup();
  process.exitCode = savedExitCode;
});

async function invoke(
  transport: "cli" | "mcp",
  paths: string[],
  allowance = 2000,
  expectedVersion?: string,
) {
  process.exitCode = undefined;
  if (transport === "cli") {
    let text = "";
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        text += String(chunk);
        return true;
      });
    try {
      const args = [...paths, "--allowance", String(allowance)];
      if (expectedVersion) args.push("--expected-version", expectedVersion);
      await dispatchCommand("read", args);
      return { text, rendered: text, failed: process.exitCode === 1 };
    } finally {
      spy.mockRestore();
    }
  }
  const id = "batch-test";
  const result = await createToolRegistry({
    root: fixture.root,
  }).spekta_read.handler(
    {
      paths,
      allowance,
      ...(expectedVersion ? { expectedVersion } : {}),
    },
    undefined,
    id,
  );
  return {
    text: result.content[0].text,
    rendered: serializeMcpToolReply(id, result),
    failed: result.isError === true,
  };
}

function operandSection(text: string, position: number): string {
  const start = text.indexOf(`Operand ${position}:`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf(`Operand ${position + 1}:`, start);
  return text.slice(start, end === -1 ? undefined : end);
}

function deliveredLines(section: string): string[] {
  const match = section.match(/```txt\n([\s\S]*?)\n```/);
  return !match || match[1] === "" ? [] : match[1].split("\n");
}

function version(section: string): string {
  const marker = section.match(/\[Version: (v1-[A-Za-z0-9_-]{43})\]/)?.[1];
  expect(marker).toBeDefined();
  return marker!;
}

describe.each(["cli", "mcp"] as const)(
  "mixed read batches over %s",
  (transport) => {
    it("retains eligible siblings and identifies every unavailable operand", async () => {
      await fs.writeFile(
        path.join(fixture.root, "short.txt"),
        "SHORT_EVIDENCE\n",
      );
      await fs.writeFile(
        path.join(fixture.root, "large.txt"),
        Array.from({ length: 1000 }, (_, i) => `large evidence ${i + 1}`).join(
          "\n",
        ),
      );
      const result = await invoke(transport, [
        "short.txt",
        "large.txt",
        ".env",
        "missing.txt",
      ]);
      expect(result.text).toContain("Operand 1: returned");
      expect(result.text).toContain("Operand 2: incomplete");
      expect(result.text).toContain(
        "Operand 3: unavailable; unavailable_access",
      );
      expect(result.text).toContain(
        "Operand 4: unavailable; unavailable_access",
      );
      expect(result.text).toContain("SHORT_EVIDENCE");
      expect(result.text).not.toContain("missing.txt");
      expect(result.text).not.toContain(".env");
      expect(result.failed).toBe(true);
      expect(getTokenCount(result.rendered)).toBeLessThanOrEqual(2000);
    });

    it("shares content fairly and redistributes after a short operand completes", async () => {
      const repeated = Array.from(
        { length: 1000 },
        () => "equal evidence line",
      ).join("\n");
      await Promise.all([
        fs.writeFile(path.join(fixture.root, "left.txt"), repeated),
        fs.writeFile(path.join(fixture.root, "right.txt"), repeated),
        fs.writeFile(path.join(fixture.root, "brief.txt"), "BRIEF\n"),
      ]);
      const pair = await invoke(transport, ["left.txt", "right.txt"]);
      const three = await invoke(transport, [
        "left.txt",
        "brief.txt",
        "right.txt",
      ]);
      const leftCount = deliveredLines(operandSection(three.text, 1)).length;
      const rightCount = deliveredLines(operandSection(three.text, 3)).length;
      expect(leftCount).toBeGreaterThan(0);
      expect(rightCount).toBeGreaterThan(0);
      expect(Math.abs(leftCount - rightCount)).toBeLessThanOrEqual(1);
      expect(three.text).toContain("Operand 2: returned");
      expect(
        deliveredLines(operandSection(three.text, 1)).length +
          deliveredLines(operandSection(three.text, 3)).length,
      ).toBeGreaterThan(0);
      expect(getTokenCount(pair.rendered)).toBeLessThanOrEqual(2000);
      expect(getTokenCount(three.rendered)).toBeLessThanOrEqual(2000);
    });

    it("continues each requested range independently and detects a stale sibling", async () => {
      const left = Array.from(
        { length: 500 },
        (_, i) => `left source ${i + 1}`,
      );
      const right = Array.from(
        { length: 500 },
        (_, i) => `right source ${i + 1}`,
      );
      await Promise.all([
        fs.writeFile(path.join(fixture.root, "left.txt"), left.join("\n")),
        fs.writeFile(path.join(fixture.root, "right.txt"), right.join("\n")),
      ]);
      const first = await invoke(
        transport,
        ["left.txt[10,500]", "right.txt[10,500]"],
        2000,
      );
      const firstSections = [
        operandSection(first.text, 1),
        operandSection(first.text, 2),
      ];
      const versions = firstSections.map(version);
      const starts = firstSections.map((section) =>
        Number(section.match(/Next range: [^[]+\[(\d+),/)?.[1]),
      );
      for (const section of firstSections) {
        expect(section).toContain("Original range: ");
        expect(section).toContain("[10,500]");
        expect(section).toContain("Next range:");
      }
      const changed =
        transport === "cli"
          ? await fs.writeFile(
              path.join(fixture.root, "left.txt"),
              `${left.join("\n")}\nchanged`,
            )
          : await fs.writeFile(
              path.join(fixture.root, "left.txt"),
              `${left.join("\n")}\nchanged`,
            );
      void changed;
      const continuedLeft = await invoke(
        transport,
        [`left.txt[${starts[0]},500]`],
        8000,
        versions[0],
      );
      const continuedRight = await invoke(
        transport,
        [`right.txt[${starts[1]},500]`],
        8000,
        versions[1],
      );
      expect(continuedLeft.text).toContain("version_mismatch");
      expect(continuedLeft.text).not.toContain(`left source ${starts[0]}`);
      expect(continuedRight.text).toContain("right source");
      expect(continuedRight.failed).toBe(false);
      expect([
        ...deliveredLines(firstSections[1]),
        ...deliveredLines(continuedRight.text),
      ]).toEqual(right.slice(9));
      expect(getTokenCount(continuedLeft.rendered)).toBeLessThanOrEqual(8000);
      expect(getTokenCount(continuedRight.rendered)).toBeLessThanOrEqual(8000);
    });

    it("withholds an oversized first line while returning a later short operand", async () => {
      const privateLine = "PRIVATE_LONG_LINE ".repeat(1000);
      await fs.writeFile(path.join(fixture.root, "oversized.txt"), privateLine);
      await fs.writeFile(
        path.join(fixture.root, "short.txt"),
        "SHORT_SURVIVES\n",
      );
      const result = await invoke(
        transport,
        ["oversized.txt", "short.txt"],
        2000,
      );
      const first = operandSection(result.text, 1);
      expect(first).toContain("budget_limited");
      expect(first).toContain("line 1 withheld");
      expect(first).toContain("[Version:");
      expect(first).toContain("Next range:");
      expect(first).not.toContain("PRIVATE_LONG_LINE");
      expect(result.text).toContain("SHORT_SURVIVES");
      expect(result.text).toMatch(/larger allowance/i);
      expect(result.failed).toBe(true);
      expect(getTokenCount(result.rendered)).toBeLessThanOrEqual(2000);
    });

    it("rejects metadata overflow before reading content", async () => {
      const read = vi.spyOn(readUtils, "getVersionedFileLines");
      const result = await invoke(
        transport,
        Array.from({ length: 40 }, () => "real.txt"),
        300,
      );
      expect(result.text).toContain("output_limit_exceeded");
      expect(result.text).toMatch(/split/i);
      expect(result.text).toMatch(/larger allowance/i);
      expect(result.text).not.toContain("####");
      expect(read).not.toHaveBeenCalled();
      expect(getTokenCount(result.rendered)).toBeLessThanOrEqual(300);
    });

    it("conceals long protected and missing names while retaining a sibling", async () => {
      const protectedName = `${"p".repeat(220)}.txt`;
      const missingName = `${"m".repeat(220)}.txt`;
      await fs.writeFile(
        path.join(fixture.root, protectedName),
        "PRIVATE_PROTECTED",
      );
      await fs.appendFile(
        path.join(fixture.root, ".spektaignore"),
        `\n${protectedName}\n`,
      );
      const result = await invoke(transport, [
        "real.txt",
        protectedName,
        missingName,
      ]);
      expect(result.text).toContain("needle INTERNAL");
      expect(result.text).toContain("Operand 2: unavailable");
      expect(result.text).toContain("Operand 3: unavailable");
      expect(result.text).not.toContain(protectedName);
      expect(result.text).not.toContain(missingName);
      expect(result.text).not.toContain("PRIVATE_PROTECTED");
      expect(getTokenCount(result.rendered)).toBeLessThanOrEqual(2000);
    });

    it("conceals engine diagnostics and continues with the next eligible operand", async () => {
      const original = readUtils.getVersionedFileLines;
      const read = vi.spyOn(readUtils, "getVersionedFileLines");
      read
        .mockImplementationOnce(() =>
          Promise.reject(new Error("PRIVATE_DIAGNOSTIC")),
        )
        .mockImplementation((...args) => original(...args));
      const result = await invoke(transport, ["real.txt", "real.txt"]);
      expect(result.text).toContain("Operand 1: internal_failure");
      expect(result.text).toContain("Operand 2: returned");
      expect(result.text).toContain("needle INTERNAL");
      expect(result.text).not.toContain("PRIVATE_DIAGNOSTIC");
      expect(operandSection(result.text, 1)).not.toContain("real.txt");
    });

    it("handles empty, EOF and duplicate operands as separate results", async () => {
      await fs.writeFile(path.join(fixture.root, "empty.txt"), "");
      const result = await invoke(
        transport,
        ["empty.txt", "real.txt[99,$]", "real.txt[1,1]", "real.txt[1,1]"],
        3000,
      );
      for (let position = 1; position <= 4; position++)
        expect(result.text).toContain(`Operand ${position}: returned`);
      expect(operandSection(result.text, 1)).toContain("no lines; total 0");
      expect(operandSection(result.text, 2)).toContain("no lines; total");
      expect(operandSection(result.text, 3)).toContain(
        "Original range: real.txt[1,1]",
      );
      expect(operandSection(result.text, 4)).toContain(
        "Original range: real.txt[1,1]",
      );
      expect(result.text).toContain("Batch: success");
      expect(result.failed).toBe(false);
      expect(getTokenCount(result.rendered)).toBeLessThanOrEqual(3000);
    });
  },
);

it("reports all operands unattempted when the MCP workspace is unavailable", async () => {
  const response = await createToolRegistry({
    root: path.join(fixture.base, "missing-workspace"),
  }).spekta_read.handler({
    paths: ["private.txt", "other.txt"],
    allowance: 2000,
  });
  expect(response.isError).toBe(true);
  expect(response.content[0].text).toContain("Operand 1: unattempted");
  expect(response.content[0].text).toContain("Operand 2: unattempted");
  expect(response.content[0].text).not.toContain("private.txt");
  expect(response.content[0].text).not.toContain("missing-workspace");
});

it("saves the same complete mixed result that the CLI prints", async () => {
  await fs.writeFile(path.join(fixture.root, "short.txt"), "SAVED_SHORT\n");
  await fs.writeFile(
    path.join(fixture.root, "large.txt"),
    Array.from({ length: 1000 }, (_, i) => `saved line ${i + 1}`).join("\n"),
  );
  let stdout = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  let savedPath: string | undefined;
  try {
    await dispatchCommand("read", [
      "short.txt",
      "large.txt",
      ".env",
      "--save",
      "--allowance",
      "2000",
    ]);
    const match = stdout.match(/Output saved to: (.+)\n/);
    expect(match).not.toBeNull();
    savedPath = match![1];
    const saved = await fs.readFile(savedPath, "utf8");
    expect(stdout).toBe(`${saved}Output saved to: ${savedPath}\n`);
    expect(saved).toContain("SAVED_SHORT");
    expect(saved).toContain("Operand 1:");
    expect(saved).toContain("Operand 2:");
    expect(saved).toContain("Operand 3: unavailable");
    expect(saved).toContain("[Version:");
    expect(saved).toContain("Next range:");
    expect(getTokenCount(stdout)).toBeLessThanOrEqual(2000);
  } finally {
    spy.mockRestore();
    if (savedPath) await fs.remove(savedPath);
  }
});

it("documents partial results, metadata reservation and separate continuation", () => {
  const help = renderTopic(NATIVE_HELP.read);
  expect(help).toContain("partial_result");
  expect(help).toMatch(/metadata (?:is )?reserved/i);
  expect(help).toMatch(/each Next range separately/i);
});
