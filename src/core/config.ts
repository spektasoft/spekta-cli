export * from "./config/types";
export * from "./config/paths";
export {
  getEnv,
  getEnvValue,
  getReadTokenLimit,
  getCompactThreshold,
} from "./config/env";
export * from "./config/ignore";
export * from "./config/providers";
export { loadToolDefinitions } from "./config/tools";
export * from "./config/prompts";
export * from "./config/bootstrap";

import { resetInternalState as coreResetEnvState } from "./config/env";
import { resetCachedTools } from "./config/tools";

export const resetInternalState = () => {
  coreResetEnvState(resetCachedTools);
};
