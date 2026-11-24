import { expect, test } from 'bun:test';
import { formatTextFormValue } from '../store/text-form-field-options.ts';

test('legacy numeric formats round decimal input without binary floating-point artifacts', () => {
  for (const [input, format, expected] of [
    ['1.005', '0.00', '1.01'],
    ['-1.005', '0.00', '-1.01'],
    ['999.995', '#,##0.00', '1,000.00'],
    ['.5', '0.00', '0.50'],
    ['0.00505', '0.00%', '0.51%'],
    ['12.5%', '0.00', '0.13'],
    ['12.5%', '0.00%', '12.50%'],
    ['9007199254740993', '#,##0', '9,007,199,254,740,993'],
    ['1.', '0.00', '1.00'],
  ])
    expect(formatTextFormValue(input!, { type: 'number', format: format! })).toBe(expected!);
});
