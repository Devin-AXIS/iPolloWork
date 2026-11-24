import { expect, test } from 'bun:test';
import {
  assertSerializableName,
  assertSerializableNamespace,
} from '../package/ooxml-serialize-validation.ts';
import { XMLNS_NAMESPACE_URI } from '../package/ooxml-shared.ts';

test('serialization validation retains exact failures with populated and saturated contexts', () => {
  const contexts = [undefined, {}, {}];
  for (let i = 0; i < 400; i++) {
    assertSerializableName(`name${i}`, contexts[2]);
    assertSerializableNamespace(`urn:example:${i}`, contexts[2]);
  }
  for (const context of contexts) {
    for (let repeat = 0; repeat < 3; repeat++) {
      for (const name of ['paragraph', '属性', '\u{10000}name', 'n'.repeat(2048)])
        expect(() => assertSerializableName(name, context)).not.toThrow();
      for (const uri of ['', 'urn:example:a&b', 'urn:例', 'u'.repeat(2048)])
        expect(() => assertSerializableNamespace(uri, context)).not.toThrow();
      for (const name of ['', 'a:b', '1name', 'name\u0000', 'name\ud800', 'n'.repeat(2048) + ':'])
        expect(() => assertSerializableName(name, context)).toThrow(
          `invalid local name for OOXML serialization: ${JSON.stringify(name)}`
        );
      for (const uri of ['urn:\u0000', 'urn:\uffff', 'urn:\udfff', 'u'.repeat(2048) + '\u0001'])
        expect(() => assertSerializableNamespace(uri, context)).toThrow(
          'namespace URI contains a character not valid in XML 1.0'
        );
      expect(() => assertSerializableNamespace(XMLNS_NAMESPACE_URI, context)).toThrow(
        'the XMLNS namespace cannot name an OOXML element or authored attribute'
      );
      for (const value of [undefined, null, 1, true, [], new String('urn:example:a&b')])
        expect(() => assertSerializableNamespace(value as string, context)).toThrow(
          `namespace URI must be a string scalar (got ${typeof value})`
        );
    }
  }
});
