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
      hasExactSensitiveException("nested/private.key", [
        "allow-sensitive: nested/private.key",
      ]),
    ).toBe(true);
    expect(
      hasExactSensitiveException(String.raw`nested\private.key`, [
        "allow-sensitive: nested/private.key",
      ]),
    ).toBe(true);
    expect(
      hasExactSensitiveException("nested/private.key", [
        "allow-sensitive: private.key",
      ]),
    ).toBe(false);
    expect(
      hasExactSensitiveException("nested/other.key", [
        "allow-sensitive: nested/private.key",
      ]),
    ).toBe(false);
    expect(
      hasExactSensitiveException("private.key", [
        "allow-sensitive: private.key",
      ]),
    ).toBe(true);
    expect(
      hasExactSensitiveException("nested/private.key", ["!nested/private.key"]),
    ).toBe(false);
  });

  it.each([
    "allow-sensitive: *.key",
    "allow-sensitive: nested/*.key",
    "allow-sensitive: nested/private.ke?",
    "allow-sensitive: nested/private.[k]ey",
    "allow-sensitive: /nested/private.key",
    "allow-sensitive: ./nested/private.key",
    "allow-sensitive: nested/../nested/private.key",
    String.raw`allow-sensitive: nested\private.key`,
    "nested/private.key",
    "allow-sensitive:",
  ])("does not grant an exception for %s", (pattern) => {
    expect(hasExactSensitiveException("nested/private.key", [pattern])).toBe(
      false,
    );
  });
});
