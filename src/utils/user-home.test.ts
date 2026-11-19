import { describe, expect, it } from "vitest";
import { getUserHomeDirectory } from "./user-home.js";

describe("getUserHomeDirectory", () => {
  it("uses USERPROFILE on Windows even when HOME is set", () => {
    expect(
      getUserHomeDirectory(
        { HOME: "C:\\GitHome", USERPROFILE: "C:\\Users\\Spekta" },
        "win32",
        "C:\\Fallback",
      ),
    ).toBe("C:\\Users\\Spekta");
  });

  it("falls back to the host home when the platform variable is missing", () => {
    expect(getUserHomeDirectory({}, "win32", "C:\\Users\\Spekta")).toBe(
      "C:\\Users\\Spekta",
    );
    expect(getUserHomeDirectory({}, "linux", "/home/spekta")).toBe(
      "/home/spekta",
    );
  });

  it("continues to prefer HOME on Unix", () => {
    expect(
      getUserHomeDirectory(
        { HOME: "/home/spekta", USERPROFILE: "C:\\Users\\Spekta" },
        "linux",
        "/fallback",
      ),
    ).toBe("/home/spekta");
  });
});
