/** Scalar bounds for an observed sequence of comparisons against constant line room. */
export interface WidthComparisonProof {
  readonly acceptedWidth: number;
  readonly rejectedWidth: number;
  readonly tolerance: number;
}

export const MAX_WIDTH_COMPARISON_ROOM = 2 ** 20;

/** Preserve the original addition and comparison, including equality at the tolerance edge. */
export function widthComparisonProofHolds(proof: WidthComparisonProof, room: number): boolean {
  return (
    Number.isFinite(room) &&
    room >= 1 &&
    room <= MAX_WIDTH_COMPARISON_ROOM &&
    proof.acceptedWidth <= room + proof.tolerance &&
    proof.rejectedWidth > room + proof.tolerance
  );
}

/**
 * The caller observes the actual algorithm, not an assumed monotonic measurement function.
 * Different room on any comparison invalidates this constant-room proof.
 * The result retains scalars only. It does not prove the caller's other layout branches.
 */
export function createWidthComparisonProof(tolerance: number): {
  observe(width: number, room: number, fits: boolean): void;
  finish(): WidthComparisonProof | undefined;
} {
  let valid = Number.isFinite(tolerance) && tolerance >= 0 && tolerance <= 1;
  let firstRoom: number | undefined;
  let acceptedWidth = -Infinity;
  let rejectedWidth = Infinity;
  return {
    observe(width, room, fits) {
      if (!valid) return;
      if (
        !Number.isFinite(width) ||
        width < 0 ||
        width > MAX_WIDTH_COMPARISON_ROOM ||
        !Number.isFinite(room) ||
        room < 1 ||
        room > MAX_WIDTH_COMPARISON_ROOM ||
        fits !== width <= room + tolerance ||
        (firstRoom !== undefined && room !== firstRoom)
      ) {
        valid = false;
        return;
      }
      firstRoom = room;
      if (fits) acceptedWidth = Math.max(acceptedWidth, width);
      else rejectedWidth = Math.min(rejectedWidth, width);
    },
    finish() {
      if (!valid || firstRoom === undefined || acceptedWidth === -Infinity) return undefined;
      return { acceptedWidth, rejectedWidth, tolerance };
    },
  };
}
