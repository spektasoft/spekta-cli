import { CollapseRegion } from "./types";

export function renderCompactedContent(
  lines: string[],
  regions: CollapseRegion[],
  startLine: number = 1,
): { content: string; didCompact: boolean } {
  if (regions.length === 0) {
    return { content: lines.join("\n"), didCompact: false };
  }

  // Sort regions sequentially by opening line
  const sorted = [...regions].sort((a, b) => a.openLine - b.openLine);

  // Filter out overlapping nested regions: outer container takes precedence
  const effectiveRegions: CollapseRegion[] = [];
  const occupiedLines = new Set<number>();

  for (const region of sorted) {
    if (occupiedLines.has(region.openLine)) {
      continue;
    }
    const bodyLines = region.closeLine - region.openLine - 1;
    if (bodyLines <= 0) {
      continue;
    }
    effectiveRegions.push(region);
    for (let i = region.openLine; i <= region.closeLine; i++) {
      occupiedLines.add(i);
    }
  }

  if (effectiveRegions.length === 0) {
    return { content: lines.join("\n"), didCompact: false };
  }

  const collapsedLines = new Set<number>();
  for (const region of effectiveRegions) {
    for (let i = region.openLine + 1; i < region.closeLine; i++) {
      collapsedLines.add(i);
    }
  }

  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (collapsedLines.has(i)) {
      const region = effectiveRegions.find((r) => i === r.openLine + 1);
      if (region) {
        const absStart = startLine + region.openLine + 1;
        const absEnd = startLine + region.closeLine - 1;
        const indent = lines[region.openLine].match(/^\s*/)?.[0] || "";
        result.push(
          `${indent}  // ... [lines ${absStart}-${absEnd} collapsed]`,
        );
      }
      continue;
    }
    result.push(lines[i]);
  }

  return { content: result.join("\n"), didCompact: true };
}
