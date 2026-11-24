// Records `-webkit-` style writes. happy-dom drops `-webkit-text-stroke-*` and
// `-webkit-text-fill-color` from inline styles (capricorn86/happy-dom#2401), so a test reads
// what paint wrote instead of what the style object kept. happy-dom calls `setProperty` on
// the target behind its style proxy, so writes are one ordered list, not keyed by style.

/** Each `-webkit-` property paint writes, in order, until `stop()`. */
export function recordWebkitStyleWrites(): {
  readonly writes: Array<readonly [name: string, value: string]>;
  stop(): void;
} {
  const proto = CSSStyleDeclaration.prototype;
  const setProperty = proto.setProperty;
  const writes: Array<readonly [string, string]> = [];
  proto.setProperty = function (this: CSSStyleDeclaration, name, value, priority) {
    if (name.startsWith('-webkit-')) writes.push([name, String(value)]);
    return setProperty.call(this, name, value, priority);
  };
  return {
    writes,
    stop: () => {
      proto.setProperty = setProperty;
    },
  };
}
