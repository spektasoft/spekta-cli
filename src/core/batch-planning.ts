export type BatchOperandStatus =
  | "returned"
  | "incomplete"
  | "unavailable"
  | "budget_limited"
  | "unattempted"
  | "version_mismatch"
  | "internal_failure";

export interface BatchOperandOutcome {
  /** One-based position in the original request. */
  position: number;
  status: BatchOperandStatus;
}

/**
 * Admission must happen before content retrieval.
 * maximumMetadataBytes includes the complete transport envelope and notices.
 * UTF-8 byte length conservatively bounds the byte-based tokenizer's tokens.
 */
export function admitBatchMetadata(
  maximumMetadataBytes: number,
  responseBudget: number,
): boolean {
  return maximumMetadataBytes <= responseBudget;
}

/**
 * Allocate indivisible units using their cumulative content cost.
 * The lowest next cumulative cost gets the next opportunity; ties preserve
 * operand order. A unit is accepted only if the complete response fits.
 *
 * Reconsider previously rejected candidates after another operand advances:
 * completing that operand may release continuation metadata.
 */
export function allocateFairBatch(
  totals: readonly number[],
  cumulativeCost: (position: number, count: number) => number,
  fits: (counts: readonly number[]) => boolean,
): number[] {
  const counts = totals.map(() => 0);

  for (;;) {
    const candidates = totals
      .map((total, position) => ({
        position,
        total,
        cost:
          counts[position] < total
            ? cumulativeCost(position, counts[position] + 1)
            : Infinity,
      }))
      .filter(({ position, total }) => counts[position] < total)
      .sort(
        (left, right) =>
          left.cost - right.cost || left.position - right.position,
      );

    let advanced = false;
    for (const { position } of candidates) {
      const next = [...counts];
      next[position]++;
      if (!fits(next)) continue;
      counts[position]++;
      advanced = true;
      break;
    }
    if (!advanced) return counts;
  }
}
