/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { GitBranch, GitCommitHorizontal, Loader2, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isElectronRuntime } from "../../../../app/utils";
import {
  layoutGraph,
  shortSha,
  shortRef,
  type GraphCommit,
  type GraphRef,
  type LayoutCommit,
} from "./graph-layout";

const LANE_WIDTH = 26;
const ROW_HEIGHT = 26;
const RADIUS = 7;
const MAX_COMMITS = 1200;

type GraphData = {
  ok: boolean;
  isRepo: boolean;
  error?: string;
  count?: number;
  totalCount?: number | null;
  truncated?: boolean;
  commits?: GraphCommit[];
  refs?: GraphRef[];
  headShas?: string[];
};

function commitMessage(sha: string): string {
  return shortSha(sha);
}

type GitPanelProps = {
  workspaceRoot: string;
  onClose?: () => void;
};

export function GitPanel({ workspaceRoot, onClose }: GitPanelProps) {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);

  const fetchGraph = () => {
    if (!isElectronRuntime()) {
      setData({ ok: false, isRepo: false, error: "Git panel is available in the desktop app." });
      setLoading(false);
      return;
    }
    const graph = window.__IPOLLOWORK_ELECTRON__?.git?.graph;
    if (!graph) {
      setData({ ok: false, isRepo: false, error: "Git bridge is unavailable." });
      setLoading(false);
      return;
    }
    setLoading(true);
    void graph({ cwd: workspaceRoot, maxCommits: MAX_COMMITS })
      .then((result) => {
        setData(result as GraphData);
        setSelectedSha(null);
      })
      .catch((error) => {
        setData({ ok: false, isRepo: false, error: error instanceof Error ? error.message : "Could not read git graph." });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot]);

  const { rows, laneCount } = useMemo(() => {
    if (!data?.ok || !data.commits) return { rows: [] as LayoutCommit[], laneCount: 0 };
    return layoutGraph(data.commits, data.refs ?? []);
  }, [data]);

  const width = Math.max(320, laneCount * LANE_WIDTH + 24);

  const edgeLines = useMemo(() => {
    if (!rows.length) return [];
    const lines: { key: string; d: string; stub?: boolean }[] = [];
    const rowBySha = new Map(rows.map((r) => [r.sha, r.row]));
    const laneBySha = new Map(rows.map((r) => [r.sha, r.lane]));
    for (const commit of rows) {
      for (const parent of commit.parents) {
        const childX = commit.lane * LANE_WIDTH + LANE_WIDTH / 2;
        const childY = commit.row * ROW_HEIGHT + ROW_HEIGHT / 2;
        const parentRow = rowBySha.get(parent);
        if (parentRow === undefined) {
          // Parent lies outside the fetched window (truncated history).
          // Draw a short dangling stub downward to signal the cut.
          const stubEnd = childY + 12;
          lines.push({
            key: `${commit.sha}-${parent}`,
            d: `M ${childX} ${childY} L ${childX} ${stubEnd}`,
            stub: true,
          });
          continue;
        }
        const parentLane = laneBySha.get(parent);
        if (parentLane === undefined) continue;
        const parentX = parentLane * LANE_WIDTH + LANE_WIDTH / 2;
        const parentY = parentRow * ROW_HEIGHT + ROW_HEIGHT / 2;
        if (commit.lane === parentLane) {
          lines.push({ key: `${commit.sha}-${parent}`, d: `M ${childX} ${childY} L ${parentX} ${parentY}` });
        } else {
          const midY = childY + (parentY - childY) / 2;
          lines.push({
            key: `${commit.sha}-${parent}`,
            d: `M ${childX} ${childY} V ${midY} H ${parentX} V ${parentY}`,
          });
        }
      }
    }
    return lines;
  }, [rows]);

  const selected = selectedSha ? rows.find((r) => r.sha === selectedSha) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="git-panel">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <GitBranch className="size-4 text-muted-foreground" />
          <span>Git 图谱</span>
          <span className="text-xs font-normal text-muted-foreground">泳道</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Refresh git graph" onClick={fetchGraph}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
          {onClose ? (
            <Button variant="ghost" size="icon-sm" aria-label="Close git panel" onClick={onClose}>
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
      </header>

      {data?.ok && data.truncated && data.totalCount !== undefined && data.totalCount !== null ? (
        <div className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-600" data-testid="git-truncated-banner">
          <GitBranch className="size-3.5 shrink-0" />
          <span>
            历史已截断：显示前 {data.count} 条，仓库共有 {data.totalCount} 条提交。虚线表示截断边界。
          </span>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>读取 Git 图谱…</span>
            </div>
          ) : !data?.ok ? (
            <div className="px-4 py-6">
              <p className="text-sm text-muted-foreground">
                {data?.isRepo === false ? "当前目录不是 Git 仓库。" : data?.error ?? "无法读取 Git 图谱。"}
              </p>
              {data?.error ? <p className="mt-2 text-xs text-destructive">{data.error}</p> : null}
            </div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">没有可显示的提交。</p>
          ) : (
            <div className="min-w-max">
              <svg width={width} height={rows.length * ROW_HEIGHT + 8} className="block">
                {edgeLines.map((line) => (
                  <path
                    key={line.key}
                    d={line.d}
                    fill="none"
                    stroke={line.stub ? "var(--color-muted-foreground)" : "var(--color-border)"}
                    strokeWidth={line.stub ? 1 : 1.5}
                    strokeDasharray={line.stub ? "3 3" : undefined}
                    opacity={line.stub ? 0.7 : 0.8}
                  />
                ))}
                {rows.map((commit) => {
                  const x = commit.lane * LANE_WIDTH + LANE_WIDTH / 2;
                  const y = commit.row * ROW_HEIGHT + ROW_HEIGHT / 2;
                  const isHead = data.headShas?.includes(commit.sha) ?? false;
                  const isSelected = selectedSha === commit.sha;
                  const fill = isHead ? "var(--color-ring)" : isSelected ? "var(--color-primary)" : "var(--color-muted-foreground)";
                  return (
                    <g
                      key={commit.sha}
                      onClick={() => setSelectedSha(isSelected ? null : commit.sha)}
                      style={{ cursor: "pointer" }}
                    >
                      <circle cx={x} cy={y} r={RADIUS + 4} fill="transparent" />
                      <circle cx={x} cy={y} r={RADIUS} fill={fill} stroke="var(--color-background)" strokeWidth={1.5} />
                    </g>
                  );
                })}
              </svg>
              <div className="space-y-px pb-4">
                {rows.map((commit) => {
                  const x = commit.lane * LANE_WIDTH + LANE_WIDTH / 2;
                  const y = commit.row * ROW_HEIGHT + ROW_HEIGHT / 2;
                  const isHead = data.headShas?.includes(commit.sha) ?? false;
                  const isSelected = selectedSha === commit.sha;
                  return (
                    <button
                      key={commit.sha}
                      type="button"
                      onClick={() => setSelectedSha(isSelected ? null : commit.sha)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-0.5 text-left font-mono text-xs transition-colors hover:bg-muted",
                        isSelected && "bg-muted",
                      )}
                      style={{ paddingLeft: x + 12 }}
                    >
                      <GitCommitHorizontal className="size-3 shrink-0 text-muted-foreground" />
                      <span className="font-medium text-foreground">{shortSha(commit.sha)}</span>
                      {commit.refs.map((ref) => (
                        <span
                          key={ref.refname}
                          className={cn(
                            "rounded px-1.5 py-px text-[10px] font-normal",
                            ref.head || isHead ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {shortRef(ref.refname)}
                        </span>
                      ))}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <aside className="flex w-72 shrink-0 flex-col border-l border-border p-4">
          <h3 className="mb-2 text-sm font-semibold">提交详情</h3>
          {selected ? (
            <div className="space-y-3">
              <div>
                <span className="text-xs text-muted-foreground">Commit</span>
                <p className="break-all font-mono text-sm">{selected.sha}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">父提交</span>
                {selected.parents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">根提交</p>
                ) : (
                  selected.parents.map((parent) => (
                    <p key={parent} className="break-all font-mono text-sm">{shortSha(parent)}</p>
                  ))
                )}
              </div>
              {selected.refs.length > 0 ? (
                <div>
                  <span className="text-xs text-muted-foreground">引用</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {selected.refs.map((ref) => (
                      <span key={ref.refname} className="rounded bg-muted px-1.5 py-px font-mono text-xs">{shortRef(ref.refname)}</span>
                    ))}
                  </div>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">{commitMessage(selected.sha)}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">点击图中的提交查看详情。</p>
          )}
        </aside>
      </div>
    </div>
  );
}
