import { describe, expect, it } from "vitest";
import { hasExactSensitiveException, isSensitivePath } from "./sensitive-files";

describe("sensitive file defaults", () => {
  it.each([
    ".env",
    "nested/.env.production",
    "nested/private.pem",
    "nested/private.key",
    "nested/store.p12",
    "nested/store.pfx",
    "nested/store.jks",
    "nested/store.keystore",
    "nested/.npmrc",
    "nested/.netrc",
    "nested/credentials",
    String.raw`nested\private.key`,
  ])("protects %s", (target) => {
    expect(isSensitivePath(target)).toBe(true);
  });

  it.each([
    ".env.example",
    "nested/.env.example",
    "nested/environment.txt",
    "nested/private.key.example",
    "nested/credentials.txt",
  ])("keeps %s eligible for other policy checks", (target) => {
    expect(isSensitivePath(target)).toBe(false);
  });
});

describe("exact sensitive exceptions", () => {
  it("matches only the exact workspace-relative path", () => {
    expect(
      hasExactSensitiveException("nested/private.key", ["!nested/private.key"]),
    ).toBe(true);
    expect(
      hasExactSensitiveException(String.raw`nested\private.key`, [
        "!nested/private.key",
      ]),
    ).toBe(true);
    expect(
      hasExactSensitiveException("nested/private.key", ["!private.key"]),
    ).toBe(false);
    expect(
      hasExactSensitiveException("nested/other.key", ["!nested/private.key"]),
    ).toBe(false);
    expect(hasExactSensitiveException("private.key", ["!private.key"])).toBe(
      true,
    );
  });

  it.each([
    "!*.key",
    "!nested/*.key",
    "!nested/private.ke?",
    "!nested/private.[k]ey",
    "!/nested/private.key",
    "!./nested/private.key",
    "!nested/../nested/private.key",
    String.raw`!nested\private.key`,
    "nested/private.key",
    "!",
  ])("does not grant an exception for %s", (pattern) => {
    expect(hasExactSensitiveException("nested/private.key", [pattern])).toBe(
      false,
    );
  });
});
