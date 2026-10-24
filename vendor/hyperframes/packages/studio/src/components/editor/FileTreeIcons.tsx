import {
  File,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson2,
  FileText,
  FileType2,
  FileVideo,
  type LucideIcon,
} from "lucide-react";

const SZ = 14;
export function FileIcon({ path }: { path: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  let Icon: LucideIcon = File;
  let color = "#6B7280";
  if (["html", "css", "js", "mjs", "cjs", "jsx", "ts", "mts", "tsx"].includes(ext)) {
    Icon = FileCode2;
    if (ext === "html") color = "#E44D26";
    else if (ext === "css") color = "#264DE4";
    else if (ext === "jsx") color = "#61DAFB";
    else if (["js", "mjs", "cjs"].includes(ext)) color = "#F0DB4F";
    else color = "#3178C6";
  } else if (ext === "json") {
    Icon = FileJson2;
    color = "#4ADE80";
  } else if (["svg", "png", "jpg", "jpeg", "webp", "gif", "ico"].includes(ext)) {
    Icon = FileImage;
    color = ext === "svg" ? "#F97316" : "#22C55E";
  } else if (["mp4", "webm", "mov"].includes(ext)) {
    Icon = FileVideo;
    color = "#A855F7";
  } else if (["mp3", "wav", "ogg", "m4a"].includes(ext)) {
    Icon = FileAudio;
    color = "#1FBAC0";
  } else if (["woff", "woff2", "ttf", "otf"].includes(ext)) {
    Icon = FileType2;
  } else if (["md", "mdx", "txt"].includes(ext)) {
    Icon = FileText;
    color = "#9CA3AF";
  }
  return <Icon size={SZ} strokeWidth={1.8} color={color} className="flex-shrink-0" />;
}

// ── Tree Types ──

export interface TreeNode {
  name: string;
  fullPath: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  targetPath: string;
  targetIsFolder: boolean;
}

export interface InlineInputState {
  /** Parent folder path (empty string for root) */
  parentPath: string;
  /** "file" or "folder" creation, or "rename" */
  mode: "new-file" | "new-folder" | "rename";
  /** For rename mode, the original full path */
  originalPath?: string;
  /** For rename mode, the original name */
  originalName?: string;
  onCommit?: (name: string) => void;
  onCancel?: () => void;
}

// ── Tree Helpers ──

export function buildTree(files: string[]): TreeNode {
  const root: TreeNode = { name: "", fullPath: "", children: new Map(), isFile: false };
  for (const file of files) {
    const parts = file.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullPath,
          children: new Map(),
          isFile: isLast,
        });
      }
      current = current.children.get(part)!;
      if (isLast) current.isFile = true;
    }
  }
  return root;
}

export function sortChildren(children: Map<string, TreeNode>): TreeNode[] {
  return Array.from(children.values()).sort((a, b) => {
    // index.html always first
    if (a.name === "index.html") return -1;
    if (b.name === "index.html") return 1;
    // Directories before files
    if (!a.isFile && b.isFile) return -1;
    if (a.isFile && !b.isFile) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function isActiveInSubtree(node: TreeNode, activeFile: string | null): boolean {
  if (!activeFile) return false;
  if (node.fullPath === activeFile) return true;
  for (const child of node.children.values()) {
    if (isActiveInSubtree(child, activeFile)) return true;
  }
  return false;
}
