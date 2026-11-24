import { PackageEditRefusal } from '../store/store/package-edit-refusal.ts';
import { withoutDocumentProperties } from '../store/package/document-property-removal.ts';
import {
  documentProperty,
  documentPropertiesPart,
  validDocumentPropertyWrites,
  withDocumentProperties,
  DOCUMENT_PROPERTY_NAMES,
} from '../store/package/document-property-writes.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationPackageReads } from './reads.ts';
import { BODY_STORY } from './stories.ts';

export function planDocumentProperties(
  operation: Extract<
    AutomationOperation,
    { op: 'getDocumentProperty' | 'setDocumentProperties' | 'removeDocumentInformation' }
  >,
  reads: AutomationPackageReads,
  pin: () => PlannedOperation | null,
  supportsPartCreation = true
): PlannedOperation {
  const refused = (message: string): PlannedOperation => ({
    ok: false,
    error: { code: 'unsupported-content', message },
  });
  if (!reads.package) return refused('document unavailable');
  if (operation.op === 'getDocumentProperty') {
    if (!DOCUMENT_PROPERTY_NAMES.includes(operation.name))
      return refused('unsupported document property');
    return {
      ok: true,
      kind: 'query',
      value: { kind: 'text', text: documentProperty(reads.package, operation.name) },
    };
  }
  if (operation.op === 'removeDocumentInformation') {
    if (operation.removeDocInfoType !== 'DocumentProperties' || !supportsPartCreation)
      return {
        ok: false,
        error: {
          code: 'unsupported-capability',
          message: 'Only direct DocumentProperties removal outside collaboration is supported.',
        },
      };
    if (!withoutDocumentProperties(reads.package))
      return {
        ok: false,
        error: {
          code: 'unsupported-capability',
          message: 'Document property parts have unsupported structure or dependencies.',
        },
      };
    const conflict = pin();
    if (conflict) return conflict;
    return {
      ok: true,
      kind: 'command',
      story: BODY_STORY,
      ops: [],
      packageEdits: [
        (pkg) => {
          const next = withoutDocumentProperties(pkg);
          if (!next) throw new PackageEditRefusal('document property parts changed');
          return next;
        },
      ],
      answer: () => ({ kind: 'applied' }),
    };
  }
  if (!validDocumentPropertyWrites(operation.values))
    return refused('invalid document property values');
  if (!supportsPartCreation && !documentPropertiesPart(reads.package))
    return {
      ok: false,
      error: {
        code: 'unsupported-capability',
        message:
          'Create document properties before joining collaboration; concurrent core-part creation cannot merge safely.',
      },
    };
  const values = { ...operation.values };
  if (!withDocumentProperties(reads.package, values))
    return {
      ok: false,
      error: {
        code: 'unsupported-capability',
        message: 'the core properties part cannot be updated safely',
      },
    };
  const conflict = pin();
  if (conflict) return conflict;
  return {
    ok: true,
    kind: 'command',
    story: BODY_STORY,
    ops: [],
    packageEdits: [
      (pkg) => {
        const next = withDocumentProperties(pkg, values);
        if (!next) throw new PackageEditRefusal('document properties package changed');
        return next;
      },
    ],
    answer: () => ({ kind: 'applied' }),
  };
}
