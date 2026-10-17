import type { HelpTopic } from "./help-topic";

import { PROXY_WORKSPACE_LIST_HELP } from "./help-proxy-workspace-list";
import { PROXY_WORKSPACE_FIND_HELP } from "./help-proxy-workspace-find";
import { PROXY_GIT_HELP } from "./help-proxy-git";
import { PROXY_GIT_STATUS_HELP } from "./help-proxy-git-status";
import { PROXY_GIT_HISTORY_HELP } from "./help-proxy-git-history";
import { PROXY_GIT_DIFF_HELP } from "./help-proxy-git-diff";
import { PROXY_GIT_BRANCH_HELP } from "./help-proxy-git-branch";

/** Supported proxy forms documented from their request classifiers and policies. */
export const PROXY_HELP: Record<string, HelpTopic> = {
  ...PROXY_WORKSPACE_LIST_HELP,
  ...PROXY_WORKSPACE_FIND_HELP,
  ...PROXY_GIT_HELP,
  ...PROXY_GIT_STATUS_HELP,
  ...PROXY_GIT_HISTORY_HELP,
  ...PROXY_GIT_DIFF_HELP,
  ...PROXY_GIT_BRANCH_HELP,
};
