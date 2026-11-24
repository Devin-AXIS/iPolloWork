import { bindSurfaceDrop } from './surface-drop.ts';
import { createInlineImageDrag } from './inline-image-drag.ts';

/** Native drops and internal image drags share cancellation and mounted-host ownership. */
export function bindSurfaceDragControllers(...args: Parameters<typeof bindSurfaceDrop>) {
  const drop = bindSurfaceDrop(...args);
  const image = createInlineImageDrag(args[0], args[1], args[3]);
  return {
    refresh: drop.refresh,
    clear() {
      image.cancel();
      drop.clear();
    },
    destroy() {
      image.destroy();
      drop.destroy();
    },
  };
}
