type OpenableTarget = {
  kind: string;
  value: string;
};

/**
 * A materialized template entry is the editable Design document, not a
 * generic HTML artifact. Sending it to the ordinary artifact panel exposes
 * source code and hides the canvas editor.
 */
export function isTemplateDesignEntryTarget(target: OpenableTarget, entryPath: string | null | undefined) {
  return target.kind === "file"
    && Boolean(entryPath)
    && target.value.replaceAll("\\", "/") === entryPath?.replaceAll("\\", "/");
}
