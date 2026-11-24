/**
 * Compile-time gate: the public contract vocabulary must stay identical to the
 * store/layout authority in `store/table-border-style.ts`.
 */
import type { TableBorderStyle as ContractTableBorderStyle } from '../contracts/editor';
import type { TableBorderStyle as StoreTableBorderStyle } from '../store/table-border-style';

type Assert<T extends true> = T;

type AssertExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type StylesMatch = AssertExact<ContractTableBorderStyle, StoreTableBorderStyle>;
type _contractMatchesStore = Assert<StylesMatch>;

type DriftProbe = AssertExact<ContractTableBorderStyle, StoreTableBorderStyle | 'groove'>;
// @ts-expect-error parity gate must reject vocabulary drift
type _driftProbeFails = Assert<DriftProbe>;
