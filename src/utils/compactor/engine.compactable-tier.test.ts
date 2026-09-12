import { describe, expect, it } from "vitest";
import { extractCollapseRegions } from "./engine";
import { KNOWN_COMPACTABLE_LANGUAGES } from "./parser";

// One representative snippet per compactable language, guaranteed to contain
// at least one function/method construct. When adding a language to
// KNOWN_COMPACTABLE_LANGUAGES, add its sample here first: this suite fails if
// the tier and this map ever drift apart, and fails again if the sample
// produces zero CollapseRegions (the signal that the grammar's node kinds are
// not actually covered by ast.ts).
const COMPACTABLE_LANGUAGE_SAMPLES: Record<
  string,
  { file: string; code: string }
> = {
  typescript: {
    file: "sample.ts",
    code: `class Bar {\n  method() {\n    return 1;\n  }\n}`,
  },
  tsx: {
    file: "sample.tsx",
    code: `class Bar {\n  method() {\n    return <div/>;\n  }\n}`,
  },
  javascript: {
    file: "sample.js",
    code: `class Bar {\n  method() {\n    return 1;\n  }\n}`,
  },
  php: {
    file: "sample.php",
    code: `<?php\nclass Bar {\n  public function method() {\n    return 1;\n  }\n}`,
  },
  kotlin: {
    file: "sample.kt",
    code: `class Bar {\n  fun method(): Int {\n    return 1\n  }\n}`,
  },
};

describe("KNOWN_COMPACTABLE_LANGUAGES node-kind coverage", () => {
  it("has exactly one sample per compactable language, and vice versa", () => {
    const tierLanguages = [...KNOWN_COMPACTABLE_LANGUAGES].sort();
    const sampleLanguages = Object.keys(COMPACTABLE_LANGUAGE_SAMPLES).sort();
    expect(sampleLanguages).toEqual(tierLanguages);
  });

  for (const language of KNOWN_COMPACTABLE_LANGUAGES) {
    it(`produces at least one CollapseRegion for "${language}"`, () => {
      const sample = COMPACTABLE_LANGUAGE_SAMPLES[language];
      expect(sample).toBeDefined();
      const regions = extractCollapseRegions(sample.file, sample.code);
      expect(regions.length).toBeGreaterThan(0);
    });
  }
});
