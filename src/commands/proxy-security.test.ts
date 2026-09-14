import { describe, expect, it } from "vitest";

import {
  isCommandSafe,
  redactSecrets,
  validateCommandArguments,
} from "./proxy-security";

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
