import { describe, it, expect, vi } from "vitest";
import autocomplete from "inquirer-autocomplete-standalone";
import { searchableSelect } from "./ui";

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("inquirer-autocomplete-standalone", () => ({
  default: vi.fn(),
}));

describe("promptCommitHash", () => {
  it("should accept valid hash format", () => {
    const validator = (v: string) =>
      /^[0-9a-f]{7,40}$/i.test(v) || "Invalid hash";
    expect(validator("abc1234")).toBe(true);
    expect(validator("invalid")).toBe("Invalid hash");
  });
});

describe("searchableSelect", () => {
  it("provides a source filter returning choices via resolved promise", async () => {
    let capturedSource: ((input?: string) => Promise<unknown>) | undefined;
    vi.mocked(autocomplete).mockImplementationOnce((config) => {
      capturedSource = config.source;
      return Object.assign(Promise.resolve("val-1"), {
        cancel: () => {},
      });
    });

    const choices = [
      { name: "Alpha", value: "val-1", description: "First item" },
      { name: "Beta", value: "val-2", description: "Second item" },
    ];

    await searchableSelect("Choose option", choices);

    expect(capturedSource).toBeDefined();
    const resultAll = await capturedSource!();
    expect(resultAll).toEqual(choices);

    const resultFiltered = await capturedSource!("Beta");
    expect(resultFiltered).toEqual([choices[1]]);
  });
});
