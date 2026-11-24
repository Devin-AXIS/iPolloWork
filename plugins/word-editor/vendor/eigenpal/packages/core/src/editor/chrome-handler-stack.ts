/** Last-mounted chrome handlers with order-independent disposal. */
export function createChromeHandlerStack<T extends object>(
  empty: T
): {
  readonly current: () => T;
  readonly push: (handlers: T) => () => void;
} {
  const stack: T[] = [];
  return {
    current: () => stack[stack.length - 1] ?? empty,
    push: (handlers) => {
      stack.push(handlers);
      return () => {
        const at = stack.lastIndexOf(handlers);
        if (at >= 0) stack.splice(at, 1);
      };
    },
  };
}
