export type BlockType =
  | "test"
  | "test-suite"
  | "function"
  | "method"
  | "arrow"
  | "class"
  | "object"
  | "brace"
  | "interface"
  | "trait"
  | "enum";

export interface CollapseRegion {
  openLine: number;
  closeLine: number;
  type: BlockType;
}

export interface CompactionResult {
  content: string;
  isCompacted: boolean;
}

export interface CompactionStrategy {
  canHandle(extension: string): boolean;
  compact(
    lines: string[],
    startLine: number,
  ): { content: string; didCompact: boolean };
}
