interface EditableTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
  getAttribute?: (name: string) => string | null;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;

  const element = target as EditableTargetLike;
  const tagName = element.tagName?.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select" || tagName === "button") return true;
  if (element.isContentEditable) return true;

  const role = element.getAttribute?.("role");
  if (role === "textbox" || role === "searchbox" || role === "combobox" || role === "slider" || role === "spinbutton") return true;

  return Boolean(
    element.closest?.(
      "input, textarea, select, [contenteditable='true'], [role='textbox'], [role='slider'], [role='spinbutton'], button, [role='menu'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='listbox'], [role='option'], [role='tab'], .cm-editor",
    ),
  );
}
