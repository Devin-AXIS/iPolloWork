import { XMLNS_NAMESPACE_URI } from './ooxml-shared.ts';
import { isXmlNCName } from './qname.ts';
import { assertValidXmlText } from './sinks.ts';

interface ValidatedNames {
  readonly names: Set<string>;
  readonly namespaces: Set<string>;
}

// Each serialization owns its prefix context. Keep only bounded, validated scalar
// values in that lifetime; never infer validity from mutable nodes or attributes.
const validatedByContext = new WeakMap<object, ValidatedNames>();
const MAX_ENTRIES = 256;
const MAX_LENGTH = 512;

function cacheFor(value: string, context?: object): ValidatedNames | undefined {
  if (context === undefined || typeof value !== 'string' || value.length > MAX_LENGTH)
    return undefined;
  let cache = validatedByContext.get(context);
  if (cache === undefined) {
    cache = { names: new Set(), namespaces: new Set() };
    validatedByContext.set(context, cache);
  }
  return cache;
}

/** @internal Validate every uncached name, including after the cache fills. */
export function assertSerializableName(localName: string, context?: object): void {
  const names = cacheFor(localName, context)?.names;
  if (names?.has(localName)) return;
  if (!isXmlNCName(localName))
    throw new Error(`invalid local name for OOXML serialization: ${JSON.stringify(localName)}`);
  if (names && names.size < MAX_ENTRIES) names.add(localName);
}

/** @internal Namespace validation does not need an escaped copy of the URI. */
export function assertSerializableNamespace(namespaceUri: string, context?: object): void {
  const namespaces = cacheFor(namespaceUri, context)?.namespaces;
  if (namespaces?.has(namespaceUri)) return;
  if (namespaceUri === XMLNS_NAMESPACE_URI)
    throw new Error('the XMLNS namespace cannot name an OOXML element or authored attribute');
  assertValidXmlText(namespaceUri, 'namespace URI');
  if (namespaces && namespaces.size < MAX_ENTRIES) namespaces.add(namespaceUri);
}
