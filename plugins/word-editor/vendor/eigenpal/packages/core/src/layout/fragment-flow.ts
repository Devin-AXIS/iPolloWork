import type { BlockFragmentRecord } from './semantic-records.ts';

/** Positioned frames and floating tables paint without consuming ordinary story flow. */
export function isOutOfFlowFragment(fragment: BlockFragmentRecord): boolean {
  return 'outOfFlow' in fragment && fragment.outOfFlow === true;
}
