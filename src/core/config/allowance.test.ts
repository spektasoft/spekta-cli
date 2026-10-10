import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAllowanceSettings, resolveRequestAllowance } from "./allowance";

const KEYS = [
  "SPEKTA_READ_TOKEN_LIMIT",
  "SPEKTA_READ_TOKEN_CEILING",
  "SPEKTA_GREP_TOKEN_LIMIT",
  "SPEKTA_GREP_TOKEN_CEILING",
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("resolveAllowanceSettings", () => {
  it("keeps defaults and supplies finite ceilings", () => {
    expect(resolveAllowanceSettings("read")).toMatchObject({
      defaultTokens: 1000,
      ceilingTokens: 8000,
      honorsRequestAllowance: true,
    });
    expect(resolveAllowanceSettings("search")).toMatchObject({
      defaultTokens: 2000,
      ceilingTokens: 16000,
      honorsRequestAllowance: false,
    });
  });
  it("honors environment configuration while keeping the default permitted", () => {
    process.env.SPEKTA_READ_TOKEN_LIMIT = "300";
    process.env.SPEKTA_READ_TOKEN_CEILING = "900";
    expect(resolveAllowanceSettings("read").ceilingTokens).toBe(900);
    process.env.SPEKTA_READ_TOKEN_CEILING = "50";
    expect(resolveAllowanceSettings("read").ceilingTokens).toBe(300);
  });
  it("uses the fallback for invalid ceilings", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.SPEKTA_READ_TOKEN_CEILING = "abc";
    expect(resolveAllowanceSettings("read").ceilingTokens).toBe(8000);
  });
});

describe("resolveRequestAllowance", () => {
  it("accepts omitted and positive integer allowances through the ceiling", () => {
    expect(resolveRequestAllowance("read", undefined)).toMatchObject({
      status: "ok",
    });
    expect(resolveRequestAllowance("read", "8000")).toMatchObject({
      status: "ok",
      requested: 8000,
    });
  });
  it("rejects excessive and malformed allowances", () => {
    expect(resolveRequestAllowance("read", 8001).status).toBe("over_ceiling");
    for (const value of [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      "abc",
      "0",
      null,
      {},
      true,
    ]) {
      expect(resolveRequestAllowance("read", value).status).toBe("invalid");
    }
  });
});
