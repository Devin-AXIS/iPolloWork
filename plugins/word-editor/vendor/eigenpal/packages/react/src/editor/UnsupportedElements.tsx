import {
  Children,
  Fragment,
  isValidElement,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  observeUnsupportedElements,
  type UnsupportedElement,
  type UnsupportedElementHost,
} from '@docx-editor.dev/core/editor';

// Empty render results keep the visible built-in fallback, including nested fragments.
function hasContent(content: ReactNode): boolean {
  return Children.toArray(content).some((child) => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      return hasContent(child.props.children);
    }
    return typeof child !== 'string' || child.trim().length > 0;
  });
}

export function UnsupportedElementPlaceholder({
  host,
  children,
}: {
  host: UnsupportedElementHost;
  children: ReactNode;
}) {
  const custom = hasContent(children);
  useLayoutEffect(() => {
    host.setCustomized(custom);
    return () => {
      host.setCustomized(false);
    };
  }, [host, custom]);
  return custom ? createPortal(children, host.slot) : null;
}

export function UnsupportedElements({
  container,
  render,
}: {
  container: HTMLElement;
  render: (element: UnsupportedElement) => ReactNode;
}) {
  const [hosts, setHosts] = useState<readonly UnsupportedElementHost[]>([]);
  useLayoutEffect(() => {
    let latest: readonly UnsupportedElementHost[] = [];
    const stop = observeUnsupportedElements(container, (next) => {
      latest = next;
      setHosts(next);
    });
    return () => {
      stop();
      // A paint can publish a new host before React commits its scheduled render.
      // Restore that host too if the override disappears in the same interval.
      for (const host of latest) host.setCustomized(false);
    };
  }, [container]);
  return hosts.map((host) => (
    <UnsupportedElementPlaceholder key={host.key} host={host}>
      {render(host.unsupported)}
    </UnsupportedElementPlaceholder>
  ));
}
