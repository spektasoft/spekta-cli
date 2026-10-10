import fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToolRegistry } from "../api/mcp-server/registry";
import { dispatchCommand } from "../cli/commands";
import { serializeMcpToolReply } from "../__tests__/mcp-response-test-utils";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../__tests__/workspace-fixture";
import { getTokenCount } from "../utils/read-utils";

let fixture: WorkspaceFixture;
let savedExitCode: typeof process.exitCode;
let originalCwd: string;
beforeEach(async () => {
  savedExitCode = process.exitCode;
  originalCwd = process.cwd();
  process.exitCode = undefined;
  fixture = await createWorkspaceFixture();
  process.chdir(fixture.root);
});
afterEach(async () => {
  process.chdir(originalCwd);
  await fixture.cleanup();
  process.exitCode = savedExitCode;
  vi.restoreAllMocks();
});

async function invoke(
  transport: "cli" | "mcp",
  operand: string,
  expectedVersion?: unknown,
  allowance = 600,
): Promise<{ text: string; failed: boolean; rendered: string }> {
  if (transport === "cli") {
    let rendered = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      rendered += String(chunk);
      return true;
    });
    const args = [operand, "--allowance", String(allowance)];
    if (expectedVersion !== undefined)
      args.push(
        "--expected-version",
        typeof expectedVersion === "string"
          ? expectedVersion
          : (JSON.stringify(expectedVersion) ?? ""),
      );
    await dispatchCommand("read", args);
    return { text: rendered, failed: process.exitCode === 1, rendered };
  }
  const id = "version-test";
  const result = await createToolRegistry({
    root: fixture.root,
  }).spekta_read.handler(
    {
      paths: [operand],
      allowance,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    },
    undefined,
    id,
  );
  const rendered = serializeMcpToolReply(id, result);
  return {
    text: result.content[0].text,
    failed: result.isError === true,
    rendered,
  };
}
const marker = (text: string) =>
  text.match(/\[Version: (v1-[A-Za-z0-9_-]{43})\]/)?.[1];

describe.each(["cli", "mcp"] as const)(
  "version-aware read over %s",
  (transport) => {
    it("continues unchanged content and rejects edits without returning source", async () => {
      const lines = Array.from(
        { length: 100 },
        (_, i) => `line ${i + 1}: Unicode สวัสดี 🌏`,
      );
      await fs.writeFile(
        path.join(fixture.root, "lines.txt"),
        lines.join("\n"),
      );
      let start = 1;
      let version: string | undefined;
      const delivered: string[] = [];
      while (start <= lines.length) {
        const response = await invoke(
          transport,
          `lines.txt[${start},100]`,
          version,
          360,
        );
        expect(getTokenCount(response.rendered)).toBeLessThanOrEqual(360);
        const found = marker(response.text);
        expect(found).toBeDefined();
        if (version) expect(found).toBe(version);
        version = found;
        const range = response.text.match(/lines (\d+)-(\d+) of 100/);
        expect(range).not.toBeNull();
        const end = Number(range![2]);
        const chunk = response.text
          .split("```txt\n")[1]
          .split("\n```")[0]
          .split("\n");
        delivered.push(...chunk);
        start = end + 1;
        if (end === 100) break;
      }
      expect(delivered).toEqual(lines);
      await fs.writeFile(
        path.join(fixture.root, "lines.txt"),
        lines.map((line, i) => (i === 99 ? `${line}!` : line)).join("\n"),
      );
      const stale = await invoke(transport, "lines.txt[2,4]", version, 360);
      expect(stale.text).toContain("version_mismatch");
      expect(stale.text).toContain("restart");
      expect(stale.text).not.toContain("```txt");
      expect(stale.text).not.toContain("line 2:");
      const fresh = await invoke(transport, "lines.txt[2,4]", undefined, 360);
      expect(marker(fresh.text)).not.toBe(version);
    });

    it("binds a version to path and original bytes, including empty files and EOF", async () => {
      await fs.writeFile(path.join(fixture.root, "empty.txt"), "");
      const first = await invoke(transport, "empty.txt", undefined, 600);
      const again = await invoke(transport, "empty.txt", undefined, 600);
      expect(marker(first.text)).toBe(marker(again.text));
      expect(first.text).toContain("no lines; total 0");
      await fs.writeFile(path.join(fixture.root, "empty.txt"), "added");
      expect(
        (await invoke(transport, "empty.txt", marker(first.text), 600)).text,
      ).toContain("version_mismatch");
      const eof = await invoke(transport, "empty.txt[99,$]", undefined, 600);
      expect(eof.text).toContain("no lines; total 1");
      await fs.appendFile(path.join(fixture.root, "empty.txt"), "\nmore");
      expect(
        (await invoke(transport, "empty.txt[99,$]", marker(eof.text), 600))
          .text,
      ).toContain("version_mismatch");
    });

    it("detects eligible symlink retargeting and conceals unavailable targets", async () => {
      await fs.writeFile(
        path.join(fixture.root, "first.txt"),
        "identical bytes\n",
      );
      await fs.writeFile(
        path.join(fixture.root, "second.txt"),
        "identical bytes\n",
      );
      const link = path.join(fixture.root, "link.txt");
      await fs.symlink("first.txt", link);
      const initial = await invoke(transport, "link.txt", undefined, 600);
      const oldVersion = marker(initial.text)!;
      await fs.unlink(link);
      await fs.symlink("second.txt", link);
      const changed = await invoke(transport, "link.txt[1,1]", oldVersion, 600);
      expect(changed.text).toContain("version_mismatch");
      expect(changed.text).not.toContain("identical bytes");
      expect(changed.text).not.toContain(fixture.root);
      await fs.unlink(link);
      const outside = path.join(fixture.outside, "secret-outside.txt");
      await fs.writeFile(outside, "outside private bytes");
      await fs.symlink(outside, link);
      const denied = await invoke(transport, "link.txt", oldVersion, 600);
      expect(denied.text).toContain("unavailable_access");
      expect(denied.text).not.toContain("secret-outside");
      expect(denied.text).not.toContain("outside private bytes");
      expect(denied.text).not.toContain(oldVersion);
    });

    it("accepts both CLI marker syntaxes around the operand", async () => {
      if (transport !== "cli") return;
      await fs.writeFile(
        path.join(fixture.root, "syntax.txt"),
        "syntax content\n",
      );
      const initial = await invoke(transport, "syntax.txt", undefined, 600);
      const version = marker(initial.text)!;
      for (const args of [
        ["--expected-version", version, "syntax.txt", "--allowance", "600"],
        ["syntax.txt", `--expected-version=${version}`, "--allowance", "600"],
      ]) {
        let output = "";
        const spy = vi
          .spyOn(process.stdout, "write")
          .mockImplementation((chunk) => {
            output += String(chunk);
            return true;
          });
        await dispatchCommand("read", args);
        expect(output).toContain("syntax content");
        spy.mockRestore();
      }
    });

    it("rejects malformed, empty and multi-path expected versions without content", async () => {
      const operand = "version-input.txt";
      const source = "VERSION_INPUT_PRIVATE_CONTENT";
      await fs.writeFile(path.join(fixture.root, operand), `${source}\n`);

      const initial = await invoke(transport, operand, undefined, 600);
      expect(initial.failed).toBe(false);
      expect(initial.text).toContain(source);
      const value = marker(initial.text);
      expect(value).toMatch(/^v1-[A-Za-z0-9_-]{43}$/);

      for (const bad of [null, 42, {}, "", "wrong"]) {
        if (transport === "mcp") {
          const result = await createToolRegistry({
            root: fixture.root,
          }).spekta_read.handler(
            { paths: [operand], expectedVersion: bad },
            undefined,
            "bad",
          );
          expect(result.isError).toBe(true);
          expect(result.content[0].text).toContain("usage_error");
          expect(result.content[0].text).not.toContain(source);
          expect(result.content[0].text).not.toContain("```");
        } else if (bad === "" || bad === "wrong") {
          const result = await invoke(transport, operand, bad, 600);
          expect(result.failed).toBe(true);
          expect(result.text).toContain("usage_error");
          expect(result.text).not.toContain(source);
          expect(result.text).not.toContain("```");
        }
      }
      if (transport === "mcp") {
        const result = await createToolRegistry({
          root: fixture.root,
        }).spekta_read.handler(
          { paths: [operand, operand], expectedVersion: value },
          undefined,
          "multi",
        );
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("usage_error");
        expect(result.content[0].text).not.toContain(source);
        expect(result.content[0].text).not.toContain("```");
      }
    });
  },
);
