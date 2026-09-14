import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveSelectedPartials, SelectivePartialLoader } from "./partials";

describe("resolveSelectedPartials", () => {
  const available = ["a.md", "b.md", "c.md"];

  it("selects only included partials when include is non-empty", () => {
    expect(
      resolveSelectedPartials(available, {
        include: ["a.md", "c.md"],
        exclude: ["b.md"],
      }),
    ).toEqual(["a.md", "c.md"]);
  });

  it("excludes only explicitly excluded partials when include is empty", () => {
    expect(
      resolveSelectedPartials(available, {
        include: [],
        exclude: ["b.md"],
      }),
    ).toEqual(["a.md", "c.md"]);
  });

  it("selects everything when both lists are empty", () => {
    expect(
      resolveSelectedPartials(available, {
        include: [],
        exclude: [],
      }),
    ).toEqual(available);
  });

  it("gives exclusion precedence over inclusion", () => {
    expect(
      resolveSelectedPartials(available, {
        include: ["b.md"],
        exclude: ["b.md"],
      }),
    ).toEqual([]);
  });
});

describe("SelectivePartialLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty template for an unselected partial", () => {
    const loader = new SelectivePartialLoader("/prompts", new Set(["a.md"]));

    expect(loader.getSource("partials/b.md")).toEqual({
      src: "",
      path: "partials/b.md",
    });
  });
});
