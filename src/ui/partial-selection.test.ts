import { describe, expect, it, vi, beforeEach } from "vitest";

import { listPartials } from "../core/config/partials";

import { checkbox, select } from "@inquirer/prompts";

import { selectPromptPartials } from "./partial-selection";

vi.mock("../core/config/partials", () => ({
  listPartials: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  checkbox: vi.fn(),
  select: vi.fn(),
}));

describe("selectPromptPartials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty selection when no partials exist", async () => {
    vi.mocked(listPartials).mockResolvedValue([]);

    await expect(selectPromptPartials()).resolves.toEqual({
      include: [],
      exclude: [],
    });

    expect(select).not.toHaveBeenCalled();
    expect(checkbox).not.toHaveBeenCalled();
  });

  it("returns the default selection for Generate Now", async () => {
    vi.mocked(listPartials).mockResolvedValue([
      { name: "a.md", filePath: "/a.md" },
      { name: "b.md", filePath: "/b.md" },
    ]);
    vi.mocked(select).mockResolvedValue("default");

    await expect(selectPromptPartials()).resolves.toEqual({
      include: [],
      exclude: [],
    });

    expect(select).toHaveBeenCalledWith({
      message: "How would you like to handle partials?",
      choices: [
        { name: "Generate Now", value: "default" },
        { name: "Include", value: "include" },
        { name: "Exclude", value: "exclude" },
      ],
    });
    expect(checkbox).not.toHaveBeenCalled();
  });

  it("returns selected partials in include mode", async () => {
    vi.mocked(listPartials).mockResolvedValue([
      { name: "a.md", filePath: "/a.md" },
      { name: "b.md", filePath: "/b.md" },
      { name: "c.md", filePath: "/c.md" },
    ]);
    vi.mocked(select).mockResolvedValue("include");
    vi.mocked(checkbox).mockResolvedValue(["a.md", "c.md"]);

    await expect(selectPromptPartials()).resolves.toEqual({
      include: ["a.md", "c.md"],
      exclude: [],
    });

    expect(checkbox).toHaveBeenCalledWith({
      message: "Select partials to include:",
      choices: [
        { name: "a.md", value: "a.md" },
        { name: "b.md", value: "b.md" },
        { name: "c.md", value: "c.md" },
      ],
    });
  });

  it("returns selected partials in exclude mode", async () => {
    vi.mocked(listPartials).mockResolvedValue([
      { name: "a.md", filePath: "/a.md" },
      { name: "b.md", filePath: "/b.md" },
      { name: "c.md", filePath: "/c.md" },
    ]);
    vi.mocked(select).mockResolvedValue("exclude");
    vi.mocked(checkbox).mockResolvedValue(["b.md"]);

    await expect(selectPromptPartials()).resolves.toEqual({
      include: [],
      exclude: ["b.md"],
    });

    expect(checkbox).toHaveBeenCalledWith({
      message: "Select partials to exclude:",
      choices: [
        { name: "a.md", value: "a.md" },
        { name: "b.md", value: "b.md" },
        { name: "c.md", value: "c.md" },
      ],
    });
  });
});
