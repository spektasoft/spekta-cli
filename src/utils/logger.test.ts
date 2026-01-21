import { vi, it, expect, describe, afterEach } from "vitest";
import { Logger } from "./logger";

describe("Logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes info to stderr", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    Logger.info("test info");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[INFO] test info\n"));
  });

  it("writes warn to stderr", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    Logger.warn("test warn");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[WARN] test warn\n"));
  });

  it("writes error to stderr", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    Logger.error("test error");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[ERROR] test error\n"));
  });

  it("writes log to stderr", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    Logger.log("test log");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("test log\n"));
  });
});
