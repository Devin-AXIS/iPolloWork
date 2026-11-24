// Whether a part renders inside `DocxEditor.Viewport`, the scroll container.
//
// An overlay positioned against the viewport's wrapper must not live inside the scroller:
// there it scrolls away with the pages. A part below the viewport renders its overlay into the
// viewport's parent element instead, the same place as a sibling of the viewport.

import { createContext, useContext, useLayoutEffect, useState } from 'react';

/** True below `DocxEditor.Viewport`. */
export const InsideViewportContext = createContext(false);

/** Where an overlay below the viewport renders, read from the mounted DOM. */
export interface ViewportOverlayHost {
  /** True below the viewport. */
  readonly inside: boolean;
  /** The viewport's parent element, or null until the viewport has mounted. */
  readonly host: HTMLElement | null;
  /** Whether `host` or an ancestor already carries the `.docx-editor` scope. */
  readonly hostScoped: boolean;
}

/**
 * Where an overlay renders. The host and its scope are read in a layout effect keyed on the
 * viewport element, after the DOM is committed and before paint, never during render. They
 * follow a remount of the viewport; a host that moves the viewport to another parent
 * without remounting it keeps the parent read at mount.
 */
export function useViewportOverlayHost(viewport: HTMLElement | null): ViewportOverlayHost {
  const inside = useContext(InsideViewportContext);
  const [target, setTarget] = useState<{ host: HTMLElement; scoped: boolean } | null>(null);
  useLayoutEffect(() => {
    const host = inside ? (viewport?.parentElement ?? null) : null;
    setTarget(host ? { host, scoped: host.closest('.docx-editor') !== null } : null);
  }, [inside, viewport]);
  return { inside, host: target?.host ?? null, hostScoped: target?.scoped ?? false };
}
