import { describe, it, expect, vi } from "vitest";

describe("promptCommitHash", () => {
  it("should accept valid hash format", () => {
    const validator = (v: string) =>
      /^[0-9a-f]{7,40}$/i.test(v) || "Invalid hash";
    expect(validator("abc1234")).toBe(true);
    expect(validator("invalid")).toBe("Invalid hash");
  });
});
