/**
 * Hebrew, Arabic, Syriac, Thaana, N'Ko, Samaritan, Mandaic and the Arabic extensions, with
 * their presentation forms: the letters that start right-to-left text. One class for line
 * breaking, bidi detection, and typed run direction, so they agree on every character.
 */
export const RIGHT_TO_LEFT_LETTER = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u;
