import { describe, expect, it } from "vitest";

import { redactSecrets } from "./proxy-secret-redaction";

describe("redactSecrets", () => {
  it("redacts OpenAI keys", () => {
    expect(redactSecrets("key=sk-abcdefghijklmnopqrstuvwxyz")).toBe(
      "key=[REDACTED]",
    );
    expect(redactSecrets("key=sk-proj-abcdefghijklmnopqrstuvwxyz")).toBe(
      "key=[REDACTED]",
    );
  });

  it("redacts GitHub personal, OAuth, user, server, refresh, and fine-grained tokens", () => {
    for (const token of [
      "ghp_abcdefghijklmnopqrstuvwxyz",
      "gho_abcdefghijklmnopqrstuvwxyz",
      "ghu_abcdefghijklmnopqrstuvwxyz",
      "ghs_abcdefghijklmnopqrstuvwxyz",
      "ghr_abcdefghijklmnopqrstuvwxyz",
      "github_pat_abcdefghijklmnopqrstuvwxyz",
    ]) {
      expect(redactSecrets(token)).toBe("[REDACTED]");
    }
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
    expect(redactSecrets("API_KEY:super-secret-value")).toBe(
      "API_KEY:[REDACTED]",
    );
    expect(redactSecrets('"api_key":"super-secret-value"')).toBe(
      '"api_key":"[REDACTED]"',
    );
    expect(redactSecrets('{"api_key":"super-secret-value"}')).toBe(
      '{"api_key":"[REDACTED]"}',
    );
    expect(redactSecrets("x-api-key='super-secret-value'")).toBe(
      "x-api-key='[REDACTED]'",
    );
    expect(redactSecrets('{"x-api-key": "super-secret-value"}')).toBe(
      '{"x-api-key": "[REDACTED]"}',
    );
  });
});
