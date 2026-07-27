export function toggleTransformScale(value: string, axis: "x" | "y") {
  const scale = `scale${axis.toUpperCase()}(-1)`;
  const transforms = value.trim() && value.trim() !== "none" ? value.trim().split(/\s+/) : [];
  const nextTransforms = transforms.includes(scale)
    ? transforms.filter((transform) => transform !== scale)
    : [...transforms, scale];

  return nextTransforms.join(" ") || "none";
}
