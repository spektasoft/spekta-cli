/** Shared rendered outcome contract used by the Git proxy renderers. */
export type DiscoveryRenderOutcome =
  | { status: "success"; content: string; truncated: boolean }
  | { status: "failure"; message: string; exitCode: number };
