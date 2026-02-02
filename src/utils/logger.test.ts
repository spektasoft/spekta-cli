import { vi, it, expect, describe, afterEach } from "vitest";
import { Logger } from "./logger";

describe("Logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes info to stderr", () => {
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    Logger.info("test info");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[INFO] test info\n"),
    );
  });

  it("writes warn to stderr", () => {
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    Logger.warn("test warn");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[WARN] test warn\n"),
    );
  });

  it("writes error to stderr", () => {
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    Logger.error("test error");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[ERROR] test error\n"),
    );
  });

  it("writes log to stderr", () => {
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    Logger.log("test log");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("test log\n"));
  });

  it("should log error with stack trace", () => {
    const error = new Error("Stack Trace Test");
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    Logger.error("Test Error", error);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[ERROR] Test Error"),
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Stack Trace Test"),
    );
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("at"));
  });

  it("should log object with inspection", () => {
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    Logger.info("Object Test", { foo: "bar" });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[INFO] Object Test"),
    );
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("bar"));
  });

  it("should handle multiple arguments", () => {
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    Logger.warn("Multiple Args", "string", 123, { nested: { value: true } });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[WARN] Multiple Args"),
    );
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("string"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("123"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("nested"));
  });
});
