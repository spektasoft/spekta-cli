import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../__tests__/workspace-fixture";
import { dispatchCommand } from "../cli/commands";
import { TOOL_REGISTRY } from "./mcp-server/registry";
import { Logger } from "../utils/logger";

let fixture: WorkspaceFixture;
beforeEach(async () => {
  fixture = await createWorkspaceFixture();
  process.chdir(fixture.root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.cleanup();
});

describe("CLI and existing MCP workspace boundaries", () => {
  it.each(["read", "grep"])(
    "CLI %s limits access to invocation cwd",
    async (command) => {
      const output: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });
      const errors = vi
        .spyOn(Logger, "error")
        .mockImplementation(() => undefined);
      await dispatchCommand(
        command,
        command === "read" ? ["real.txt"] : ["needle", "real.txt"],
      );
      expect(output.join("")).toContain("INTERNAL");
      output.length = 0;
      process.exitCode = undefined;
      await dispatchCommand(
        command,
        command === "read" ? ["../sibling.txt"] : ["needle", "../sibling.txt"],
      );
      expect(errors).toHaveBeenCalledWith(expect.stringContaining("outside"));
      expect(process.exitCode).toBe(1);
      expect(output.join("")).not.toContain("SIBLING");
    },
  );
  it("CLI commands deny symlink escapes", async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    vi.spyOn(Logger, "error").mockImplementation(() => undefined);
    for (const command of ["read", "grep"]) {
      process.exitCode = undefined;
      await dispatchCommand(
        command,
        command === "read"
          ? ["external-file.txt"]
          : ["needle", "external-file.txt"],
      );
      expect(process.exitCode).toBe(1);
    }
    expect(output.join("")).not.toContain("EXTERNAL");
  });
  it("real MCP handlers keep eligible output and reject escapes", async () => {
    expect(
      (await TOOL_REGISTRY.spekta_read.handler({ paths: ["real.txt"] }))
        .content[0].text,
    ).toContain("INTERNAL");
    expect(
      (await TOOL_REGISTRY.spekta_grep.handler({ pattern: "needle" }))
        .content[0].text,
    ).toContain("INTERNAL");
    for (const target of [
      "../sibling.txt",
      "external-file.txt",
      "external-dir/secret.txt",
    ]) {
      await expect(
        TOOL_REGISTRY.spekta_read.handler({ paths: [target] }),
      ).rejects.toThrow("outside");
      await expect(
        TOOL_REGISTRY.spekta_grep.handler({ pattern: "needle", path: target }),
      ).rejects.toThrow("outside");
    }
  });
});
