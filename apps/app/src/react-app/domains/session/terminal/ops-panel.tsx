/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Loader2, Plus, RefreshCw, Server, TerminalSquare, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { isElectronRuntime } from "../../../../app/utils";

type OpsSession = {
  id: string;
  label: string;
  target: string;
  terminalId: string | null;
  exited: boolean;
};

type OpsTerminalProps = {
  session: OpsSession;
  onStatus: (sessionId: string, status: string) => void;
  onExit: (sessionId: string) => void;
  onRequestFocus: () => void;
};

function OpsTerminal({ session, onStatus, onExit, onRequestFocus }: OpsTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!isElectronRuntime()) {
      onStatus(session.id, "Terminal is available in the desktop app.");
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    const bridge = window.__IPOLLOWORK_ELECTRON__?.terminal;
    if (!bridge?.create || !bridge.write || !bridge.resize || !bridge.kill || !bridge.onData || !bridge.onExit) {
      onStatus(session.id, "Terminal bridge is unavailable.");
      return;
    }
    const createTerminal = bridge.create;
    const writeTerminal = bridge.write;
    const resizeTerminal = bridge.resize;
    const killTerminal = bridge.kill;
    const onTerminalData = bridge.onData;
    const onTerminalExit = bridge.onExit;

    let disposed = false;
    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "'SFMono-Regular', 'Cascadia Code', 'Liberation Mono', Menlo, monospace",
      fontSize: 12,
      theme: {
        background: "#0b0d12",
        foreground: "#d7dde8",
        cursor: "#ffffff",
        selectionBackground: "#334155",
      },
    });
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.focus();
    fitAddon.fit();
    terminalRef.current = terminal;
    fitRef.current = fitAddon;

    const removeDataListener = onTerminalData(({ terminalId, data }) => {
      if (terminalIdRef.current !== terminalId) return;
      terminal.write(data);
    });
    const removeExitListener = onTerminalExit(({ terminalId }) => {
      if (terminalIdRef.current !== terminalId) return;
      terminalIdRef.current = null;
      onExit(session.id);
    });
    const inputDisposable = terminal.onData((data) => {
      const terminalId = terminalIdRef.current;
      if (!terminalId) return;
      void writeTerminal(terminalId, data);
    });

    const fitAndResize = () => {
      fitAddon.fit();
      const terminalId = terminalIdRef.current;
      if (!terminalId) return;
      void resizeTerminal(terminalId, terminal.cols, terminal.rows);
    };
    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(container);

    onStatus(session.id, `Connecting to ${session.target}…`);
    void createTerminal({
      cwd: "/",
      cols: terminal.cols,
      rows: terminal.rows,
      command: ["ssh", "-t", session.target],
    })
      .then(({ terminalId }) => {
        if (disposed) {
          void killTerminal(terminalId);
          return;
        }
        terminalIdRef.current = terminalId;
        onStatus(session.id, session.target);
        fitAndResize();
      })
      .catch((error) => {
        onStatus(session.id, error instanceof Error ? error.message : "Could not start SSH session.");
      });

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeDataListener();
      removeExitListener();
      const terminalId = terminalIdRef.current;
      terminalIdRef.current = null;
      if (terminalId) void killTerminal(terminalId);
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col"
      data-testid="ops-terminal"
      onClick={onRequestFocus}
    >
      <div ref={containerRef} className="min-h-0 flex-1 px-2 py-1 [&_.xterm]:h-full" />
    </div>
  );
}

type OpsPanelProps = {
  onClose?: () => void;
};

export function OpsPanel({ onClose }: OpsPanelProps) {
  const [sessions, setSessions] = useState<OpsSession[]>([]);
  const [statusBySession, setStatusBySession] = useState<Record<string, string>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [hosts, setHosts] = useState<string[]>([]);
  const [hostsLoading, setHostsLoading] = useState(true);
  const [configPath, setConfigPath] = useState("~/.ssh/config");
  const [quickTarget, setQuickTarget] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshHosts = () => {
    if (!isElectronRuntime()) {
      setLoadError("Ops panel is available in the desktop app.");
      setHostsLoading(false);
      return;
    }
    const listHosts = window.__IPOLLOWORK_ELECTRON__?.ssh?.listHosts;
    if (!listHosts) {
      setLoadError("SSH bridge is unavailable.");
      setHostsLoading(false);
      return;
    }
    setHostsLoading(true);
    void listHosts()
      .then(({ hosts: hostList, configPath: config }) => {
        setHosts(hostList ?? []);
        setConfigPath(config ?? "~/.ssh/config");
        setLoadError(null);
      })
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : "Could not read SSH config.");
      })
      .finally(() => setHostsLoading(false));
  };

  useEffect(() => {
    refreshHosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addSession = (target: string) => {
    const clean = target.trim().replace(/^ssh\s+/, "").replace(/^-t\s+/, "");
    if (!clean) return;
    const id = `ops_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    setSessions((prev) => [
      ...prev,
      { id, label: clean, target: clean, terminalId: null, exited: false },
    ]);
    setActiveSessionId(id);
    setQuickTarget("");
  };

  const connectQuick = () => {
    const target = quickTarget.trim();
    if (!target || connecting) return;
    setConnecting(true);
    // Defer so the terminal pane mounts before the SSH connection starts.
    window.setTimeout(() => {
      addSession(target);
      setConnecting(false);
    }, 0);
  };

  const closeSession = (sessionId: string) => {
    setSessions((prev) => prev.filter((session) => session.id !== sessionId));
    setStatusBySession((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    setActiveSessionId((current) => {
      if (current !== sessionId) return current;
      const remaining = sessions.filter((session) => session.id !== sessionId);
      return remaining.length ? remaining[remaining.length - 1].id : null;
    });
  };

  const handleStatus = (sessionId: string, status: string) => {
    setStatusBySession((prev) => ({ ...prev, [sessionId]: status }));
  };

  const handleExit = (sessionId: string) => {
    setStatusBySession((prev) => ({ ...prev, [sessionId]: "Disconnected" }));
  };

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="ops-panel">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Server className="size-4 text-muted-foreground" />
          <span>运维面板</span>
          <span className="text-xs font-normal text-muted-foreground">SSH</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Refresh SSH hosts" onClick={refreshHosts}>
            <RefreshCw className={cn("size-4", hostsLoading && "animate-spin")} />
          </Button>
          {onClose ? (
            <Button variant="ghost" size="icon-sm" aria-label="Close ops panel" onClick={onClose}>
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-border">
          <div className="space-y-2 p-3">
            <Input
              value={quickTarget}
              onChange={(event) => setQuickTarget(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") connectQuick();
              }}
              placeholder="user@host 或 ssh 别名"
              aria-label="Quick SSH connect target"
            />
            <Button
              variant="default"
              className="w-full"
              onClick={connectQuick}
              disabled={connecting || !quickTarget.trim()}
            >
              {connecting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              <span>连接</span>
            </Button>
          </div>

          <div className="flex items-center justify-between px-3 pb-1 pt-2">
            <span className="text-xs font-medium text-muted-foreground">SSH 主机（~/.ssh/config）</span>
            <span className="text-[10px] text-muted-foreground">{hosts.length}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {loadError ? (
              <p className="px-2 py-3 text-xs text-destructive">{loadError}</p>
            ) : hostsLoading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                <span>读取 SSH 配置…</span>
              </div>
            ) : hosts.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                未在 {configPath} 中发现主机。可输入 user@host 快速连接。
              </p>
            ) : (
              hosts.map((host) => (
                <button
                  key={host}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                  onClick={() => addSession(host)}
                >
                  <TerminalSquare className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono">{host}</span>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2">
            {sessions.length === 0 ? (
              <span className="px-2 text-xs text-muted-foreground">没有活动的 SSH 会话</span>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={cn(
                    "group flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs",
                    session.id === activeSessionId
                      ? "border-ring bg-muted text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-muted",
                  )}
                >
                  <button
                    type="button"
                    className="max-w-40 truncate font-mono"
                    onClick={() => setActiveSessionId(session.id)}
                  >
                    {session.label}
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground/60 hover:bg-background hover:text-foreground"
                    aria-label={`Close ${session.label}`}
                    onClick={() => closeSession(session.id)}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex h-6 shrink-0 items-center gap-2 px-3 text-[11px] text-muted-foreground">
            {activeSession ? (
              <>
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                <span className="truncate">{statusBySession[activeSession.id] ?? activeSession.target}</span>
              </>
            ) : null}
          </div>

          <div className="min-h-0 flex-1">
            {activeSession ? (
              <OpsTerminal
                key={activeSession.id}
                session={activeSession}
                onStatus={handleStatus}
                onExit={handleExit}
                onRequestFocus={() => setActiveSessionId(activeSession.id)}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                <p className="text-center">
                  在左侧选择一台主机，或输入 user@host 开始 SSH 会话。
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
