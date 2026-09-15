import { describe, expect, it } from "vitest";

import { validateCommandArguments } from "./proxy-path-security";

describe("validateCommandArguments", () => {
  it("rejects POSIX and Windows absolute path syntax", () => {
    for (const argument of [
      "/tmp/outside",
      "C:/outside",
      String.raw`C:\outside`,
      String.raw`\\server\share\outside`,
    ]) {
      expect(() => validateCommandArguments([argument])).toThrow(
        /outside the project directory/i,
      );
    }
  });
});
