import { TreeSitterCompactor } from "./compactor/index";

export {
  compactFile,
  TreeSitterCompactor,
  renderCompactedContent,
  extractCollapseRegions,
  resolveLanguage,
  type CompactionResult,
  type CompactionStrategy,
  type BlockType,
  type CollapseRegion,
} from "./compactor/index";

export const COMPACTORS = [new TreeSitterCompactor()];
