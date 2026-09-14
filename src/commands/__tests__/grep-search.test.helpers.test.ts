import { describe, expect, it } from "vitest";
import { createRgMatch } from "./grep-search.test.helpers";

describe("grep-search.test.helpers", () => {
  it("generates a valid ripgrep match JSON string", () => {
    const json = createRgMatch("test.ts", 1, 5, "content");
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("match");
    expect(parsed.data.path.text).toBe("test.ts");
    expect(parsed.data.lines.text).toBe("content\n");
  });
});
