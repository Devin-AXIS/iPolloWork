// Display-unit helpers for header/footer chrome — no engine derivation.

const TWIPS_PER_INCH = 1440;

export function twipsToInches(twips: number): number {
  return Math.round((twips / TWIPS_PER_INCH) * 100) / 100;
}

export function inchesToTwips(inches: number): number {
  return Math.round(inches * TWIPS_PER_INCH);
}
