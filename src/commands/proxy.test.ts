import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import {
  isCommandSafe,
  isRtkAvailable,
  redactSecrets,
  runRtkProxy,
  validateCommandArguments,
} from "./proxy";

describe("truncateOutput", () => {
  it("leaves output unchanged below the token limit", async () => {
    const { truncateOutput } = await import("./proxy");
    const result = truncateOutput("one\ntwo\nthree");

    expect(result.truncated).toBe(false);
    expect(result.content).toBe("one\ntwo\nthree");
  });

  it("collapses the middle of oversized output", async () => {
    const { truncateOutput } = await import("./proxy");
    const output = Array.from(
      { length: 1500 },
      (_, index) => `line-${index}`,
    ).join("\n");

    const result = truncateOutput(output);

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("lines collapsed: exceeds 1000 tokens");
    expect(result.content).toContain("line-0");
    expect(result.content).toContain("line-1499");
  });
});

describe("formatProxyOutput", () => {
  it("formats a successful result without badges", async () => {
    const { formatProxyOutput } = await import("./proxy");

    expect(formatProxyOutput("git status", "clean")).toBe(
      "### spekta git status\n\n```\nclean\n```",
    );
  });

  it("adds the truncation badge only when truncated", async () => {
    const { formatProxyOutput } = await import("./proxy");

    expect(formatProxyOutput("git log", "tail", { truncated: true })).toContain(
      "[OUTPUT TRUNCATED: >1000 TOKENS]",
    );
  });

  it("adds the failure badge only for non-zero exits", async () => {
    const { formatProxyOutput } = await import("./proxy");

    expect(formatProxyOutput("git test", "failed", { exitCode: 2 })).toContain(
      "[FAILED: Exit 2]",
    );
  });
});

describe("isCommandSafe", () => {
  it("allows standalone safe commands", () => {
    for (const command of [
      "vitest",
      "jest",
      "pytest",
      "tsc",
      "eslint",
      "ruff",
      "clippy",
      "biome",
      "tree",
      "ps",
      "ls",
    ]) {
      expect(isCommandSafe(command, [])).toBe(true);
    }
  });

  it("allows safe multi-tool subcommands", () => {
    expect(isCommandSafe("git", ["status"])).toBe(true);
    expect(isCommandSafe("git", ["log"])).toBe(true);
    expect(isCommandSafe("git", ["diff"])).toBe(true);
    expect(isCommandSafe("cargo", ["test"])).toBe(true);
    expect(isCommandSafe("cargo", ["check"])).toBe(true);
    expect(isCommandSafe("npm", ["run", "build"])).toBe(true);
    expect(isCommandSafe("pnpm", ["lint"])).toBe(true);
    expect(isCommandSafe("docker", ["build"])).toBe(true);
  });

  it("rejects destructive multi-tool commands", () => {
    expect(isCommandSafe("git", ["reset", "--hard"])).toBe(false);
    expect(isCommandSafe("git", ["clean", "-fd"])).toBe(false);
  });

  it("rejects arbitrary destructive commands", () => {
    expect(isCommandSafe("rm", ["-rf", "src"])).toBe(false);
    expect(isCommandSafe("chmod", ["777", "file"])).toBe(false);
  });
});

describe("RTK execution", () => {
  const mockExeca = vi.mocked(execa);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports RTK availability", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "rtk 1.0.0",
      stderr: "",
      exitCode: 0,
      failed: false,
    } as never);

    await expect(isRtkAvailable()).resolves.toBe(true);
  });

  it("returns false when RTK is unavailable", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not found"));

    await expect(isRtkAvailable()).resolves.toBe(false);
  });

  it("executes RTK and formats successful output", async () => {
    mockExeca
      .mockResolvedValueOnce({
        stdout: "rtk 1.0.0",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as never)
      .mockResolvedValueOnce({
        stdout: "clean",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as never);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runRtkProxy("git", ["status"]);

    expect(mockExeca).toHaveBeenLastCalledWith(
      "rtk",
      ["git", "status"],
      expect.objectContaining({
        reject: false,
      }),
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining("### spekta git"));
  });

  it("does not throw on a non-zero RTK command exit", async () => {
    mockExeca
      .mockResolvedValueOnce({
        stdout: "rtk 1.0.0",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as never)
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "command failed",
        exitCode: 2,
        failed: true,
      } as never);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(runRtkProxy("git", ["status"])).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("[FAILED: Exit 2]"),
    );
  });

  it("prints an advisory instead of executing missing RTK", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not found"));

    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runRtkProxy("git", ["status"]);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("rtk unavailable"),
    );
  });
});

describe("validateCommandArguments", () => {
  it("rejects restricted files", () => {
    expect(() => validateCommandArguments([".env"])).toThrow(
      /restricted file or path/i,
    );
    expect(() => validateCommandArguments([".gitignore"])).toThrow(
      /restricted file or path/i,
    );
    expect(() => validateCommandArguments([".spektaignore"])).toThrow(
      /restricted file or path/i,
    );
    expect(() => validateCommandArguments(["src/.gitignore"])).toThrow(
      /restricted file or path/i,
    );
    expect(() => validateCommandArguments(["foo/.spektaignore/bar"])).toThrow(
      /restricted file or path/i,
    );
  });

  it("rejects directory traversal outside the project", () => {
    expect(() => validateCommandArguments(["../outside"])).toThrow(
      /outside the project directory/i,
    );
  });

  it("accepts paths inside the project", () => {
    expect(() =>
      validateCommandArguments(["src/index.ts", "./src/commands"]),
    ).not.toThrow();
  });

  it("redacts OpenAI keys", () => {
    expect(redactSecrets("key=sk-abcdefghijklmnopqrstuvwxyz")).toBe(
      "key=[REDACTED]",
    );
  });

  it("redacts GitHub personal and OAuth tokens", () => {
    expect(redactSecrets("ghp_abcdefghijklmnopqrstuvwxyz")).toBe("[REDACTED]");
    expect(redactSecrets("gho_abcdefghijklmnopqrstuvwxyz")).toBe("[REDACTED]");
  });

  it("redacts GitLab tokens", () => {
    expect(redactSecrets("glpat-abcdefghijklmnopqrstuvwxyz")).toBe(
      "[REDACTED]",
    );
  });

  it("redacts bearer tokens", () => {
    expect(redactSecrets("Authorization: Bearer abc.def-123")).toBe(
      "Authorization: [REDACTED]",
    );
  });

  it("redacts private keys", () => {
    const key = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "secret-key-material",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");

    expect(redactSecrets(key)).toBe("[REDACTED]");
  });

  it("redacts generic api_key assignments", () => {
    expect(redactSecrets("api_key=super-secret-value")).toBe(
      "api_key=[REDACTED]",
    );
  });
});
