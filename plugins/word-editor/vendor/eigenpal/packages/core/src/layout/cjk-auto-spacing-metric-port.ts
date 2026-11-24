import type { ResolvedRunStyle } from './run-style.ts';
import type { TextMeasurer } from './text-measurer.ts';

type AuthoredGapMetric = (style: ResolvedRunStyle) => number | undefined;
const metrics = new WeakMap<TextMeasurer, AuthoredGapMetric>();

// Session-local derived metrics. This port is not part of the public measurer contract.
export function withAuthoredCjkGapMetric<T extends TextMeasurer>(
  measurer: T,
  metric: AuthoredGapMetric
): T {
  metrics.set(measurer, metric);
  return measurer;
}

/**
 * Give `to` the metric of `from`, for a measurer that wraps another one and measures with it
 * (`font-face-usage.ts`): the port keys its metric by measurer object.
 */
export function forwardAuthoredCjkGapMetric(from: TextMeasurer, to: TextMeasurer): void {
  const metric = metrics.get(from);
  if (metric) metrics.set(to, metric);
}

export function authoredCjkGapMetric(
  measurer: TextMeasurer | undefined,
  style: ResolvedRunStyle
): number | undefined {
  return measurer ? metrics.get(measurer)?.(style) : undefined;
}
