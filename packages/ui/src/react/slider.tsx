import { Slider as Primitive } from "@base-ui/react/slider";
import { cn } from "../common/control-styles";

export function Slider<Value extends number | readonly number[]>({ className, thumbLabels, ...props }: Omit<Primitive.Root.Props<Value>, "className"> & { className?: string; thumbLabels: string[] }) {
  return <Primitive.Root {...props} data-slot="slider" className={cn("flex min-h-8 min-w-0 w-full items-center data-[disabled]:opacity-50 data-[orientation=vertical]:h-40 data-[orientation=vertical]:w-8 data-[orientation=vertical]:flex-col", className)}>
    <Primitive.Control className="relative flex h-8 w-full touch-none items-center select-none data-[orientation=vertical]:h-full data-[orientation=vertical]:w-8 data-[orientation=vertical]:justify-center">
      <Primitive.Track className="relative h-1 w-full rounded-full bg-muted data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1">
        <Primitive.Indicator className="rounded-full bg-primary" />
        {thumbLabels.map((label, index) => <Primitive.Thumb key={index} index={index} aria-label={label} className="block size-3.5 rounded-full border border-primary bg-background shadow-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />)}
      </Primitive.Track>
    </Primitive.Control>
  </Primitive.Root>;
}
