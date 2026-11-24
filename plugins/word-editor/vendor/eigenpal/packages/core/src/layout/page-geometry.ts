// Page geometry records, in points. Re-exported from `semantic-records.ts`.

/** Page geometry, in points. */
export interface PageGeometry {
  readonly width: number;
  readonly height: number;
  readonly margin: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  /** `w:pgMar/@header` — sheet edge to header top, in points. Defaults to 36 (720 twips). */
  readonly headerDistance?: number;
  /** `w:pgMar/@footer` — sheet edge to footer bottom, in points. Defaults to 36. */
  readonly footerDistance?: number;
}

/** US Letter with one-inch margins, in points. */
export const DEFAULT_PAGE_GEOMETRY: PageGeometry = Object.freeze({
  width: 612,
  height: 792,
  margin: Object.freeze({ top: 72, right: 72, bottom: 72, left: 72 }),
});
