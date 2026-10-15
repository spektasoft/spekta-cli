import {
  getEnvValue,
  getGrepTokenLimit,
  getGitTokenLimit,
  getListTokenLimit,
  getReadTokenLimit,
} from "./env";

export type AllowanceFamily = "read" | "search" | "list" | "git";

export interface AllowanceSettings {
  family: AllowanceFamily;
  defaultTokens: number;
  ceilingTokens: number;
  /** False until the family's executor actually honors a per-request allowance. */
  honorsRequestAllowance: boolean;
}

export type AllowanceRequestResult =
  | { status: "ok"; requested?: number; settings: AllowanceSettings }
  | { status: "invalid"; settings: AllowanceSettings }
  | { status: "over_ceiling"; requested: number; settings: AllowanceSettings };

const FAMILIES = {
  read: {
    ceilingEnv: "SPEKTA_READ_TOKEN_CEILING",
    ceilingFallback: 8000,
    honorsRequestAllowance: true,
    getDefault: getReadTokenLimit,
  },
  list: {
    ceilingEnv: "SPEKTA_LIST_TOKEN_CEILING",
    ceilingFallback: 8000,
    honorsRequestAllowance: true,
    getDefault: getListTokenLimit,
  },
  search: {
    ceilingEnv: "SPEKTA_GREP_TOKEN_CEILING",
    ceilingFallback: 16000,
    honorsRequestAllowance: true,
    getDefault: getGrepTokenLimit,
  },
  git: {
    ceilingEnv: "SPEKTA_GIT_TOKEN_CEILING",
    ceilingFallback: 8000,
    honorsRequestAllowance: true,
    getDefault: getGitTokenLimit,
  },
} as const;

const POSITIVE_INTEGER = /^[1-9]\d*$/;

function parsePositiveInteger(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : undefined;
  }
  if (typeof raw === "string" && POSITIVE_INTEGER.test(raw)) {
    const value = Number(raw);
    return Number.isSafeInteger(value) ? value : undefined;
  }
  return undefined;
}

/** Writable configuration is not a security boundary. */
export function resolveAllowanceSettings(
  family: AllowanceFamily,
): AllowanceSettings {
  const spec = FAMILIES[family];
  const defaultTokens = spec.getDefault();
  const rawCeiling = getEnvValue(spec.ceilingEnv, String(spec.ceilingFallback));
  let ceiling = parsePositiveInteger(rawCeiling);
  if (ceiling === undefined) {
    console.warn(
      `Invalid ${spec.ceilingEnv} value "${rawCeiling}", falling back to ${spec.ceilingFallback}`,
    );
    ceiling = spec.ceilingFallback;
  }
  return {
    family,
    defaultTokens,
    ceilingTokens: Math.max(ceiling, defaultTokens),
    honorsRequestAllowance: spec.honorsRequestAllowance,
  };
}

export function resolveRequestAllowance(
  family: AllowanceFamily,
  requested: unknown,
): AllowanceRequestResult {
  const settings = resolveAllowanceSettings(family);
  if (requested === undefined) return { status: "ok", settings };
  const tokens = parsePositiveInteger(requested);
  if (tokens === undefined) return { status: "invalid", settings };
  if (tokens > settings.ceilingTokens) {
    return { status: "over_ceiling", requested: tokens, settings };
  }
  return { status: "ok", requested: tokens, settings };
}
