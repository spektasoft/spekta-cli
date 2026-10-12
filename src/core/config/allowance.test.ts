import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAllowanceSettings, resolveRequestAllowance } from "./allowance";

const KEYS = [
  "SPEKTA_READ_TOKEN_LIMIT",
  "SPEKTA_READ_TOKEN_CEILING",
  "SPEKTA_LIST_TOKEN_LIMIT",
  "SPEKTA_LIST_TOKEN_CEILING",
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
    expect(resolveAllowanceSettings("list")).toMatchObject({
      defaultTokens: 1000,
      ceilingTokens: 8000,
      honorsRequestAllowance: true,
    });
    expect(resolveAllowanceSettings("search")).toMatchObject({
      defaultTokens: 2000,
      ceilingTokens: 16000,
      honorsRequestAllowance: true,
    });
  });
  it("honors environment configuration while keeping the default permitted", () => {
    process.env.SPEKTA_READ_TOKEN_LIMIT = "300";
    process.env.SPEKTA_READ_TOKEN_CEILING = "900";
    expect(resolveAllowanceSettings("read").ceilingTokens).toBe(900);
    process.env.SPEKTA_READ_TOKEN_CEILING = "50";
    expect(resolveAllowanceSettings("read").ceilingTokens).toBe(300);
  });
  it("uses list-specific default and ceiling configuration", () => {
    process.env.SPEKTA_LIST_TOKEN_LIMIT = "300";
    process.env.SPEKTA_LIST_TOKEN_CEILING = "900";
    expect(resolveAllowanceSettings("list").ceilingTokens).toBe(900);
    process.env.SPEKTA_LIST_TOKEN_CEILING = "50";
    expect(resolveAllowanceSettings("list").ceilingTokens).toBe(300);
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
  it("resolves omitted, invalid, and over-ceiling list allowances", () => {
    expect(resolveRequestAllowance("list", undefined)).toMatchObject({
      status: "ok",
      settings: { defaultTokens: 1000 },
    });
    expect(resolveRequestAllowance("list", "bad").status).toBe("invalid");
    expect(resolveRequestAllowance("list", 8001).status).toBe("over_ceiling");
  });
  it("applies search defaults and request allowances through its ceiling", () => {
    expect(resolveRequestAllowance("search", undefined)).toMatchObject({
      status: "ok",
      settings: { defaultTokens: 2000, ceilingTokens: 16000 },
    });
    for (const value of [500, 2000, 16000]) {
      expect(resolveRequestAllowance("search", value)).toMatchObject({
        status: "ok",
        requested: value,
      });
    }
    expect(resolveRequestAllowance("search", 16001).status).toBe(
      "over_ceiling",
    );
  });
});
