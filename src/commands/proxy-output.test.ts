import { describe, expect, it } from "vitest";

import { formatProxyOutput, truncateOutput } from "./proxy";

describe("truncateOutput", () => {
  it("leaves output unchanged below the token limit", async () => {
    const { truncateOutput } = await import("./proxy");
    const result = truncateOutput("one\ntwo\nthree");

    expect(result.truncated).toBe(false);
    expect(result.content).toBe("one\ntwo\nthree");
  });

  it("collapses the middle of oversized output", async () => {
    const { truncateOutput } = await import("./proxy");
    const output = Array.from(
      { length: 1500 },
      (_, index) => `line-${index}`,
    ).join("\n");

    const result = truncateOutput(output);

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("lines collapsed: exceeds 1000 tokens");
    expect(result.content).toContain("line-0");
    expect(result.content).toContain("line-1499");
  });
});

describe("formatProxyOutput", () => {
  it("formats a successful result without badges", async () => {
    const { formatProxyOutput } = await import("./proxy");

    expect(formatProxyOutput("git status", "clean")).toBe(
      "### spekta git status\n\n```\nclean\n```",
    );
  });

  it("adds the truncation badge only when truncated", async () => {
    const { formatProxyOutput } = await import("./proxy");

    expect(formatProxyOutput("git log", "tail", { truncated: true })).toContain(
      "[OUTPUT TRUNCATED: >1000 TOKENS]",
    );
  });

  it("adds the failure badge only for non-zero exits", async () => {
    const { formatProxyOutput } = await import("./proxy");

    expect(formatProxyOutput("git test", "failed", { exitCode: 2 })).toContain(
      "[FAILED: Exit 2]",
    );
  });
});
