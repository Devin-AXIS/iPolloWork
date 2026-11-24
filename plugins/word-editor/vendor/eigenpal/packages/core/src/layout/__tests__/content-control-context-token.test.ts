// Differential for the content-control context-token memo.
//
// The randomized layout oracles cover WeakMap-on-node memos through their structuredClone
// differential, but neither oracle fixture carries content controls — so this memo gets its
// own: every token read through the memoized path must equal a memo-cold recompute over a
// structurally identical tree (structuredClone shares no node identities, so no memo entry
// can serve it). Edits are built as transaction-shaped path copies: the changed node and its
// ancestors are fresh objects, every other node is the SAME object — which is exactly the
// sharing the memo exploits.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { contentControlContextToken } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const sdt = (pr: string, content: string) =>
  `<w:sdt><w:sdtPr>${pr}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

/** The memo-cold answer: identical structure, no shared node identities. */
function uncachedToken(part: OoxmlPart): string {
  return contentControlContextToken(structuredClone(part));
}

function bodyOf(part: OoxmlPart): OoxmlElement {
  const findBody = (node: OoxmlNode): OoxmlElement | undefined => {
    if (node.kind === 'textValue') return undefined;
    if (node.kind === 'body' || node.localName === 'body') return node;
    for (const child of node.children) {
      const found = findBody(child);
      if (found) return found;
    }
    return undefined;
  };
  const body = findBody(part.root);
  if (!body) throw new Error('no body');
  return body;
}

/** Transaction-shaped path copy: a fresh body children array under fresh body/root shells. */
function withBodyChildren(
  part: OoxmlPart,
  edit: (children: readonly OoxmlNode[]) => readonly OoxmlNode[]
): OoxmlPart {
  const rebuild = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (node.kind === 'body' || node.localName === 'body') {
      return { ...node, children: edit(node.children) };
    }
    return { ...node, children: node.children.map(rebuild) };
  };
  return { ...part, root: rebuild(part.root) as OoxmlPart['root'] };
}

function isSdt(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue' && node.localName === 'sdt';
}

/** Fresh twin of one sdt with its `w:sdtPr` replaced, content children SHARED by identity. */
function withSdtPr(control: OoxmlElement, pr: string): OoxmlElement {
  const donor = load(sdt(pr, p('x')));
  const donorSdt = bodyOf(donor).children.find(isSdt)!;
  const donorPr = donorSdt.children.find(
    (child) => child.kind !== 'textValue' && child.localName === 'sdtPr'
  )!;
  return {
    ...control,
    children: control.children.map((child) =>
      child.kind !== 'textValue' && child.localName === 'sdtPr' ? donorPr : child
    ),
  };
}

const FIXTURE =
  p('before') +
  sdt(
    '<w:alias w:val="Outer"/><w:tag w:val="outer-tag"/>',
    p('inside one') + sdt('<w:alias w:val="Inner"/>', p('nested')) + p('inside two')
  ) +
  p('after');

describe('content-control context token memo differential', () => {
  test('warm token equals the memo-cold recompute', () => {
    const part = load(FIXTURE);
    const first = contentControlContextToken(part);
    // Second read is fully memoized; both must equal the clone recompute.
    expect(contentControlContextToken(part)).toBe(first);
    expect(uncachedToken(part)).toBe(first);
    expect(first).not.toBe('');
  });

  test('control add: shared siblings keep their memos, token matches cold recompute', () => {
    const part = load(FIXTURE);
    contentControlContextToken(part);
    const added = load(sdt('<w:alias w:val="Added"/>', p('new control')));
    const addedSdt = bodyOf(added).children.find(isSdt)!;
    const edited = withBodyChildren(part, (children) => [...children, addedSdt]);
    const token = contentControlContextToken(edited);
    expect(token).toBe(uncachedToken(edited));
    expect(token).not.toBe(contentControlContextToken(part));
  });

  test('retitle (alias/tag) changes the token and matches cold recompute', () => {
    const part = load(FIXTURE);
    const before = contentControlContextToken(part);
    const edited = withBodyChildren(part, (children) =>
      children.map((child) =>
        isSdt(child)
          ? withSdtPr(child, '<w:alias w:val="Renamed"/><w:tag w:val="outer-tag"/>')
          : child
      )
    );
    const token = contentControlContextToken(edited);
    expect(token).toBe(uncachedToken(edited));
    expect(token).not.toBe(before);
  });

  test('lock change reaches the token and matches cold recompute', () => {
    const part = load(FIXTURE);
    const before = contentControlContextToken(part);
    const edited = withBodyChildren(part, (children) =>
      children.map((child) =>
        isSdt(child)
          ? withSdtPr(
              child,
              '<w:alias w:val="Outer"/><w:tag w:val="outer-tag"/><w:lock w:val="sdtContentLocked"/>'
            )
          : child
      )
    );
    const token = contentControlContextToken(edited);
    expect(token).toBe(uncachedToken(edited));
    expect(token).not.toBe(before);
  });

  test('text edit inside a control keeps the token (content is not chrome)', () => {
    const part = load(FIXTURE);
    const before = contentControlContextToken(part);
    const donor = load(p('inside one EDITED'));
    const donorParagraph = bodyOf(donor).children.find((child) => child.kind === 'paragraph')!;
    const edited = withBodyChildren(part, (children) =>
      children.map((child) => {
        if (!isSdt(child)) return child;
        return {
          ...child,
          children: child.children.map((inner) => {
            if (inner.kind === 'textValue' || inner.localName !== 'sdtContent') return inner;
            const content = inner.children.map((block, index) =>
              index === 0 ? donorParagraph : block
            );
            return { ...inner, children: content };
          }),
        };
      })
    );
    const token = contentControlContextToken(edited);
    expect(token).toBe(uncachedToken(edited));
    expect(token).toBe(before);
  });

  test('a node reused at a DIFFERENT nesting depth is not served its old-depth token', () => {
    // A chain deep enough that the nesting cap clips its tail. Wrapping the SAME chain node
    // one level deeper moves the clipping point, so a depth-blind memo replaying the old
    // answer would keep one level the cold recompute clips.
    const chain = Array.from({ length: 33 }, (_, i) => i).reduceRight(
      (inner, i) => sdt(`<w:alias w:val="L${i}"/>`, inner),
      p('deepest')
    );
    const part = load(chain);
    const shallowToken = contentControlContextToken(part);
    expect(shallowToken).toBe(uncachedToken(part));

    // Wrap the existing chain (same object identity) in one more control.
    const wrapper = load(sdt('<w:alias w:val="Wrapper"/>', p('placeholder')));
    const wrapperSdt = bodyOf(wrapper).children.find(isSdt)!;
    const chainSdt = bodyOf(part).children.find(isSdt)!;
    const edited = withBodyChildren(part, (children) =>
      children.map((child) => {
        if (!isSdt(child)) return child;
        return {
          ...wrapperSdt,
          children: wrapperSdt.children.map((inner) => {
            if (inner.kind === 'textValue' || inner.localName !== 'sdtContent') return inner;
            return { ...inner, children: [chainSdt] };
          }),
        };
      })
    );
    const deeperToken = contentControlContextToken(edited);
    expect(deeperToken).toBe(uncachedToken(edited));
    expect(deeperToken).not.toBe(shallowToken);
  });
});
