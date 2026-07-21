export function protectOutputStreamFromBrokenPipe(output) {
  if (!output || typeof output.on !== "function") return output;
  output.on("error", (error) => {
    if (error?.code === "EPIPE") return;
    throw error;
  });
  return output;
}
