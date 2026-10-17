export const CODEX_USAGE_START = "<!-- spekta:codex-usage:start -->";

export const CODEX_USAGE_END = "<!-- spekta:codex-usage:end -->";

export const CODEX_HOOK_MATCHER = "^(Bash)$";

export interface CodexSetupFile {
  path: string;
  action: "create" | "update" | "unchanged" | "delete";
  content: string;
}

export interface CodexSetupPlan {
  status: "ready" | "refused";
  files: CodexSetupFile[];
  diagnostics: string[];
  conflicts: CodexSetupConflict[];
}

export interface CodexSetupConflict {
  source: string;
  kind: "rtk-rewrite" | "competing-hook" | "ambiguous-source";
  message: string;
}

export interface CodexSetupOptions {
  home: string;
  path: string;
  cwd?: string;
  mcp?: boolean;
}

export interface CodexSetupApplyResult {
  status: "configured" | "refused" | "failed";
  activation: "unverified";
  files: CodexSetupFile[];
  diagnostics: string[];
}

export interface CodexUninstallPlan {
  status: "ready" | "refused";
  files: CodexSetupFile[];
  diagnostics: string[];
}

export interface CodexUninstallResult {
  status: "uninstalled" | "refused" | "failed";
  files: CodexSetupFile[];
  diagnostics: string[];
}
