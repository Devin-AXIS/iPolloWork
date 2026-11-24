import type { VectorShapeComponent } from './drawing-shape-projection.ts';

const freezePaths = (paths: VectorShapeComponent['subpathsEmu']) =>
  Object.freeze(
    paths.map((points) => Object.freeze(points.map((point) => Object.freeze({ ...point }))))
  );

export function freezeVectorShapeComponent(component: VectorShapeComponent): VectorShapeComponent {
  return Object.freeze({
    ...component,
    subpathsEmu: freezePaths(component.subpathsEmu),
    ...(component.subpathsClosed
      ? { subpathsClosed: Object.freeze([...component.subpathsClosed]) }
      : {}),
    ...(component.arrowheadsEmu ? { arrowheadsEmu: freezePaths(component.arrowheadsEmu) } : {}),
    ...(component.shadow ? { shadow: Object.freeze({ ...component.shadow }) } : {}),
    ...(component.strokeDash ? { strokeDash: Object.freeze([...component.strokeDash]) } : {}),
    ...(component.clipEmu ? { clipEmu: freezePaths(component.clipEmu) } : {}),
    ...(component.fillPattern
      ? {
          fillPattern: Object.freeze({
            rows: Object.freeze([...component.fillPattern.rows]),
            foreground: Object.freeze({ ...component.fillPattern.foreground }),
            background: Object.freeze({ ...component.fillPattern.background }),
          }),
        }
      : {}),
    ...(component.fillGradient
      ? {
          fillGradient: Object.freeze({
            ...component.fillGradient,
            stops: Object.freeze(
              component.fillGradient.stops.map((stop) => Object.freeze({ ...stop }))
            ),
            coords: Object.freeze([...component.fillGradient.coords]),
            matrix: Object.freeze([
              ...component.fillGradient.matrix,
            ]) as typeof component.fillGradient.matrix,
          }),
        }
      : {}),
  });
}
