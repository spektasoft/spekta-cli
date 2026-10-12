import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSearchLifecycle,
  resolveSearchTelemetryBudget,
} from "../grep-search";

afterEach(() => vi.useRealTimers());

describe("search lifecycle progress", () => {
  it("delays progress, reports phase changes, and bounds heartbeats", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const phases: string[] = [];
    const lifecycle = createSearchLifecycle(
      (phase) => phases.push(phase),
      () => Date.now(),
    );

    vi.advanceTimersByTime(1999);
    expect(phases).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(phases).toEqual(["preparing"]);

    vi.advanceTimersByTime(100);
    lifecycle.setPhase("searching");
    expect(phases).toEqual(["preparing", "searching"]);
    vi.advanceTimersByTime(5000 * 8);
    expect(phases).toHaveLength(4);
    expect(phases.at(-1)).toBe("searching");

    expect(lifecycle.finish()).toEqual({
      preparationMs: 2100,
      executionMs: 40000,
    });
  });

  it("keeps fast searches silent and measures the preparation/execution boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10);
    const phases: string[] = [];
    const lifecycle = createSearchLifecycle(
      (phase) => phases.push(phase),
      () => Date.now(),
    );
    vi.setSystemTime(50);
    lifecycle.setPhase("searching");
    vi.setSystemTime(80);
    expect(lifecycle.finish()).toEqual({ preparationMs: 40, executionMs: 30 });
    expect(phases).toEqual([]);
  });

  it("reserves measured telemetry envelopes and suppresses oversized progress", () => {
    expect(resolveSearchTelemetryBudget(100, 30, true, 210, true)).toEqual({
      progressEnabled: false,
      profileEnabled: true,
      reservedTokens: 32,
    });
    expect(resolveSearchTelemetryBudget(1000, 30, true, 210, true)).toEqual({
      progressEnabled: true,
      profileEnabled: true,
      reservedTokens: 242,
    });
    expect(resolveSearchTelemetryBudget(2000, 30, true, 600, true)).toEqual({
      progressEnabled: false,
      profileEnabled: true,
      reservedTokens: 32,
    });
  });
});
