import { describe, expect, it } from "vitest";
import { parseGrepOutput } from "../grep-output-parser";
import { createRgMatch, mockExecaStream } from "./grep-search.test.helpers";

describe("parseGrepOutput", () => {
  it("formats ripgrep match lines into markdown blocks", async () => {
    const matchLine = createRgMatch("src/index.ts", 12, 4, "const val = 1;");
    const child = mockExecaStream(matchLine);

    const result = await parseGrepOutput(child);

    expect(result).toContain("#### src/index.ts");
    expect(result).toContain("```ts\n12:4:const val = 1;\n```");
  });

  it("preserves error cause when child process fails with non-1 exit code", async () => {
    const child = mockExecaStream("", 2);

    await expect(parseGrepOutput(child)).rejects.toThrow(
      "Ripgrep error: Command failed",
    );
  });
});
