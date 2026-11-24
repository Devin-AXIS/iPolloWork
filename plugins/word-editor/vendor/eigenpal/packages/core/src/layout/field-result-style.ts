/** Direction controls affect ordering but do not choose a field's visible result font. */
export function fieldResultIsDirectionOnly(text: string): boolean {
  return /^[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]+$/u.test(text);
}
