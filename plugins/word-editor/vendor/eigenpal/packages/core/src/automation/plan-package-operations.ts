// The operations that address the package as a whole: the style listing, the document property
// reads and writes, and the sections' page setup reads.
//
// INTERNAL. Split out of `plan.ts` so the main planner keeps room under its line cap. Each case
// behaves exactly as it did inline; the document property writes go through the `pin` the
// planner hands in.

import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import { planDocumentProperties } from './plan-document-properties.ts';
import { answered, refused } from './plan-results.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationPackageReads } from './reads.ts';
import { planStyleListing } from './style-listing.ts';

/** The operations this sub-planner answers. */
export type AutomationPackageOperation = Extract<
  AutomationOperation,
  {
    op:
      | 'getStyles'
      | 'getDocumentProperty'
      | 'setDocumentProperties'
      | 'removeDocumentInformation'
      | 'getSections'
      | 'getPageSetup';
  }
>;

export interface PackagePlannerContext {
  readonly reads: AutomationPackageReads;
  readonly handles: AutomationHandleTable;
  /** Pins a document property write to the body story, or answers why it cannot be. */
  readonly pin: () => PlannedOperation | null;
  /** False on a collaborative host, where a write may not create a part. */
  readonly supportsPartCreation: boolean;
}

/** Plan one package-level operation. */
export function planPackageOperation(
  operation: AutomationPackageOperation,
  context: PackagePlannerContext
): PlannedOperation {
  const { reads, handles } = context;
  switch (operation.op) {
    case 'getStyles':
      return planStyleListing(operation, reads);
    case 'getSections':
      if (!handles.resolve(operation.document, 'document'))
        return refused('invalid-handle', 'that handle does not name a document', 'document');
      return answered({
        kind: 'handles',
        handles: reads.sections().map((section) => handles.section(section.index)),
      });
    case 'getPageSetup': {
      const target = handles.resolve(operation.section, 'section');
      if (!target || target.kind !== 'section')
        return refused('invalid-handle', 'that handle does not name a section', 'section');
      const section = reads.sections()[target.index];
      if (!section) return refused('invalid-handle', 'that section is not in this document');
      return answered({ kind: 'pageSetup', setup: section.pageSetup });
    }
    default:
      return planDocumentProperties(operation, reads, context.pin, context.supportsPartCreation);
  }
}
