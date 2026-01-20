import { validatePathAccess } from "./security";
import { describe, it, expect } from "vitest";

describe("Security Validation", () => {
  it("should block restricted files even with relative paths", async () => {
    await expect(validatePathAccess("./.env")).rejects.toThrow(
      "restricted system file",
    );
  });
});
