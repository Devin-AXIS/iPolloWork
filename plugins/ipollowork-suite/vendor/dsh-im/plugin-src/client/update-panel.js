import * as React from 'react';
import { createPortal } from 'react-dom';
import validSemver from 'semver/functions/valid.js';
import compareVersionsDescending from 'semver/functions/rcompare.js';

import { h, localizeText } from './i18n.js';
import { createPollScheduler } from './lifecycle.js';

export const UPDATE_RPC_CHANNEL = '/dsh-im';

const ACTIVE_STATES = new Set(['installing', 'verifying']);
const BLOCKED_REASONS = Object.freeze({
  'source-install': '当前是源码或链接安装，只能检查版本；请手动更新源码，或迁移到 npm 安装。',
  'unknown-profile': '无法确认当前 profile，请在对应的 Harness 环境中手动更新。',
  'unsupported-runtime': '当前运行环境不支持按钮安装，请手动更新插件。',
  'registry-conflict': '当前 npm 源配置与官方源不一致，请先检查 registry 配置。',
  'incompatible-node': '当前 Host 的 Node.js 版本不满足新版要求，请先更新运行环境。',
  'pending-restart': '新版本已安装，请在方便时手动重启当前 Harness 或 Desktop。',
  'recovery-required': '上次安装结果无法确认，请先检查此 profile 的插件安装状态。',
});
const ERROR_MESSAGES = Object.freeze({
  'check-failed': '无法访问 npm 或请求超时，请稍后重新检查。',
  'update-failed': '更新请求失败，请重试。',
  'invalid-release': 'npm 返回的版本信息无效，暂时无法更新。',
  'check-expired': '版本确认已过期，请重新检查后再安装。',
  'installation-changed': '插件安装状态已发生变化，请重新检查。',
  'update-busy': '此 profile 正在更新，请稍后查看状态。',
  'install-failed': '安装失败，请检查当前安装状态后重试。',
  'verify-failed': '安装结果校验失败，请手动检查插件版本。',
  'state-unavailable': '无法安全保存更新状态，请先检查当前安装结果。',
  interrupted: '上次更新已中断，请检查安装状态后重试。',
  disposed: '更新服务已关闭，请手动重新打开设置页。',
  'bad-request': '更新请求无效，请重新检查版本。',
  'invalid-installation': '当前插件安装不完整或与 profile 不符，请手动检查安装配置。',
  'executor-unavailable': BLOCKED_REASONS['unsupported-runtime'],
  'registry-check-failed': '无法确认当前 npm 源配置，暂时不能安装更新。',
  'install-interrupted': '上次更新已中断，请检查安装状态后重试。',
  'install-timeout': '安装超时，请先确认当前安装状态，再决定是否重试。',
  'invalid-version': 'npm 返回的版本信息无效，暂时无法更新。',
});

function unwrapSnapshot(result) {
  if (result?.ok === false) {
    const error = new Error(result.error?.message || '更新请求失败，请重试。');
    error.code = result.error?.code;
    throw error;
  }
  const value = result?.value;
  if (result?.ok !== true || typeof value?.runningVersion !== 'string'
    || typeof value?.canInstall !== 'boolean') {
    throw new Error('更新服务返回了无法识别的响应。');
  }
  return value;
}

function presentError(error) {
  const code = error?.rpcError?.code ?? error?.code ?? '';
  const message = error?.rpcError?.message ?? error?.message ?? '';
  if (code === 'update-unavailable'
    || /(?:not[-_ ]found|unimplemented|unknown[-_ ](?:endpoint|channel)|no[-_ ]handler)/i.test(code)
    || /(?:not found|unknown (?:endpoint|channel)|not registered|no .*handler|HTTP 404)/i.test(message)) {
    return '当前 Host 不支持更新接口，请先手动更新插件并重启。';
  }
  return BLOCKED_REASONS[code] ?? ERROR_MESSAGES[code]
    ?? (message.slice(0, 400) || '更新请求失败，请重试。');
}

function summary(snapshot, action, error) {
  if (action === 'checking') return '正在从 npm 检查最新版本…';
  if (action === 'starting' || snapshot?.job?.state === 'installing') return '正在安装，请稍候…';
  if (snapshot?.job?.state === 'verifying') return '正在校验安装结果…';
  if (snapshot?.job?.state === 'restart-required' || snapshot?.blockedReason === 'pending-restart') {
    return '已安装，待手动重启';
  }
  if (error) return '更新请求失败';
  if (!snapshot?.job?.recoverable) {
    if (snapshot?.job?.state === 'failed') return '更新失败';
    if (snapshot?.job?.state === 'interrupted') return '上次更新已中断，请检查安装状态后重试。';
  }
  if (snapshot?.blockedReason === 'no-update') return '当前版本无需更新';
  if (snapshot?.blockedReason) return '暂时无法安装更新';
  if (snapshot?.canInstall) return '发现新版本';
  if (snapshot?.checkedAt && snapshot.latestVersion === snapshot.runningVersion) return '已是最新版本';
  if (snapshot?.checkedAt) return '已获取 npm 最新版本';
  if (snapshot?.job?.state === 'completed') return '更新已生效';
  return '检查 npm 最新版本，不会自动安装。';
}

function retainDialogFocus(event) {
  event?.currentTarget?.closest?.('.dim-updateDialog')?.focus?.({ preventScroll: true });
}

function manualUpdateCommand(snapshot) {
  const profile = snapshot?.profileName;
  if (snapshot?.sourceInstall || ['source-install', 'unknown-profile'].includes(snapshot?.blockedReason)
    || typeof profile !== 'string' || !profile.trim() || profile.length > 255
    || profile.startsWith('-') || ['.', '..', 'node_modules'].includes(profile)
    || !/^[\p{L}\p{N}_. -]+$/u.test(profile)) return null;

  // Only allow shell-neutral profile characters; spaces and Unicode stay one argument.
  const profileArgument = /^[A-Za-z0-9_.-]+$/.test(profile) ? profile : `"${profile}"`;
  const validVersion = (version) => typeof version === 'string' && validSemver(version) === version;
  const pendingRestart = snapshot.blockedReason === 'pending-restart'
    || snapshot.job?.state === 'restart-required';
  const targets = [
    snapshot.latestVersion,
    pendingRestart ? snapshot.installedVersion : null,
    snapshot.job?.state !== 'completed' && !snapshot.job?.recoverable ? snapshot.job?.targetVersion : null,
  ].filter(validVersion);
  // Keep a known target pinned, and never suggest downgrading an installed/running version.
  const version = targets.length
    ? [...targets, snapshot.runningVersion, snapshot.installedVersion]
      .filter(validVersion).sort(compareVersionsDescending)[0]
    : 'latest';
  return `dsh plugin --profile ${profileArgument} add -w @xmanrui/dsh-im@${version}`;
}

function ManualUpdateCommand({ command, disabled, sourceInstall, desktop }) {
  const [copyState, setCopyState] = React.useState('idle');
  const commandRef = React.useRef(null);
  const mounted = React.useRef(false);
  const copying = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const copy = async (event) => {
    if (!command || disabled || copying.current) return;
    retainDialogFocus(event);
    copying.current = true;
    setCopyState('copying');
    try {
      const clipboard = globalThis.navigator?.clipboard;
      if (typeof clipboard?.writeText !== 'function') throw new Error('Clipboard unavailable');
      await clipboard.writeText(command);
      if (mounted.current) setCopyState('copied');
    } catch {
      if (mounted.current) {
        setCopyState('failed');
        commandRef.current?.focus?.({ preventScroll: true });
        commandRef.current?.select?.();
      }
    } finally {
      copying.current = false;
    }
  };

  const copyLabel = copyState === 'copying' ? '复制中…' : copyState === 'copied' ? '已复制' : '复制命令';

  return h('section', { className: 'dim-updateManual', 'aria-label': '手工更新' },
    h('h4', { className: 'dim-updateManualHeading' }, '手工更新'),
    command ? h(React.Fragment, null,
      h('p', { className: 'dim-updateManualHint' }, '自动更新失败可以使用命令更新：'),
      h('div', { className: 'dim-updateCommandRow' },
        h('textarea', {
          ref: commandRef, className: 'dim-updateCommand', 'aria-label': '手工更新命令',
          value: command, readOnly: true, spellCheck: false, rows: 2, dir: 'ltr',
        }),
        h('button', {
          type: 'button', className: `dim-updateCopy${copyState === 'copied' ? ' dim-updateCopyCopied' : ''}`,
          'aria-label': copyLabel, title: copyLabel, 'aria-busy': copyState === 'copying',
          disabled: disabled || copyState === 'copying', onClick: (event) => void copy(event),
        }, h('svg', {
          width: 16, height: 16, viewBox: '0 0 20 20', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
          'aria-hidden': 'true', focusable: 'false',
        }, copyState === 'copied'
          ? h('path', { d: 'm4 10 4 4 8-8' })
          : h(React.Fragment, null,
              h('rect', { x: 7, y: 7, width: 10, height: 11, rx: 1.5 }),
              h('path', { d: 'M5 13H3.5A1.5 1.5 0 0 1 2 11.5v-8A1.5 1.5 0 0 1 3.5 2h8A1.5 1.5 0 0 1 13 3.5V5' }))))),
      command.endsWith('@xmanrui/dsh-im@latest') ? h('p', { className: 'dim-updateManualHint' },
        '尚未确认目标版本，此命令安装执行时 npm 的 latest 版本。') : null,
      h('p', { className: 'dim-updateManualHint' }, desktop
        ? '请在当前 Desktop 的内置终端执行，完成后手动重启。'
        : '请在运行当前 Harness 的同一环境执行，保持 DSH_HOME 一致，完成后手动重启。'),
      disabled ? h('p', { className: 'dim-updateManualHint' },
        '请等待当前操作结束，确认没有安装进程运行后再执行命令。') : null,
      copyState === 'failed' || copyState === 'copied' ? h('p', {
        className: copyState === 'failed' ? 'dim-updateError' : 'dim-updateManualHint',
        role: copyState === 'failed' ? 'alert' : 'status',
      }, copyState === 'failed' ? '复制失败，请选中命令后按 Ctrl+C 或 ⌘C 复制。' : '命令已复制。') : null)
      : h('p', { className: 'dim-updateManualHint' }, sourceInstall
        ? '源码或链接安装请按原安装方式更新，不提供覆盖源码的 npm 命令。'
        : '无法安全生成当前 profile 的命令，请在终端中手动确认 profile 后更新。'));
}

function UpdateDialog({ children, onClose }) {
  const dialogRef = React.useRef(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    const previous = globalThis.document?.activeElement;
    dialogRef.current?.focus?.();
    return () => { if (previous?.isConnected) previous.focus?.(); };
  }, []);

  const content = h('div', {
    className: 'dim-updateBackdrop',
    onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); },
  },
  h('section', {
    ref: dialogRef,
    className: 'dim-updateDialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    'aria-describedby': descriptionId,
    tabIndex: -1,
    onKeyDown: (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (event.key !== 'Tab') return;
      const buttons = dialogRef.current?.querySelectorAll?.('button:not(:disabled), textarea:not(:disabled)');
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      const active = globalThis.document?.activeElement;
      if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === dialogRef.current)) {
        event.preventDefault();
        first.focus();
      }
    },
  },
  h('h3', { id: titleId }, 'DSH-IM 更新'),
  h('p', { id: descriptionId, className: 'dim-updateDescription' },
    '仅更新 DSH-IM。安装完成后需手动重启后台；本功能不会自动重启或主动刷新页面。'),
  children));
  return typeof document !== 'undefined' && document.body
    ? createPortal(content, document.body)
    : content;
}

export function UpdatePanel({ rpcCall, clientVersion, onStatus }) {
  const tooltipId = React.useId();
  const [snapshot, setSnapshot] = React.useState(null);
  const [action, setAction] = React.useState('status');
  const [error, setError] = React.useState(null);
  const [open, setOpen] = React.useState(false);
  const [uncertainInstall, setUncertainInstall] = React.useState(false);
  const mounted = React.useRef(false);
  const busy = React.useRef(false);
  const readController = React.useRef(null);
  const pollReadController = React.useRef(null);
  const installRequest = React.useRef(null);
  const onStatusRef = React.useRef(onStatus);
  onStatusRef.current = onStatus;

  const accept = React.useCallback((next) => {
    setSnapshot(next);
    onStatusRef.current?.(next);
  }, []);
  const acceptAuthoritative = (next) => {
    // Abort synchronously: effect cleanup alone can lose to an already queued reply.
    pollReadController.current?.abort();
    setUncertainInstall(false);
    accept(next);
  };
  const invoke = React.useCallback(async (endpoint, payload = {}, signal) => {
    if (typeof rpcCall !== 'function') {
      const unavailable = new Error('当前 Host 不支持更新接口，请先手动更新插件并重启。');
      unavailable.code = 'update-unavailable';
      throw unavailable;
    }
    return unwrapSnapshot(await rpcCall(endpoint, payload, signal));
  }, [rpcCall]);

  React.useEffect(() => {
    mounted.current = true;
    busy.current = true;
    const controller = new AbortController();
    void invoke('update.status', {}, controller.signal).then((next) => {
      if (!controller.signal.aborted) accept(next);
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(presentError(cause));
    }).finally(() => {
      if (!controller.signal.aborted) {
        busy.current = false;
        setAction(null);
      }
    });
    return () => {
      mounted.current = false;
      controller.abort();
      readController.current?.abort();
    };
  }, [accept, invoke]);

  const activeJob = ACTIVE_STATES.has(snapshot?.job?.state);
  const restartRequired = snapshot?.job?.state === 'restart-required'
    || snapshot?.blockedReason === 'pending-restart';
  const shouldPoll = activeJob || uncertainInstall;

  React.useEffect(() => {
    if (!shouldPoll) return undefined;
    let controller;
    const scheduler = createPollScheduler({
      setTimeoutFn: (callback, delay) => globalThis.setTimeout(callback, delay),
      clearTimeoutFn: (timer) => globalThis.clearTimeout(timer),
    });
    const poll = async () => {
      const pendingController = new AbortController();
      controller = pendingController;
      pollReadController.current = pendingController;
      let keepPolling = true;
      try {
        const next = await invoke('update.status', {}, pendingController.signal);
        if (!pendingController.signal.aborted) {
          accept(next);
          setError(null);
          setUncertainInstall(false);
          keepPolling = ACTIVE_STATES.has(next.job?.state);
        }
      } catch (cause) {
        if (!pendingController.signal.aborted) setError(presentError(cause));
      } finally {
        if (pollReadController.current === pendingController) pollReadController.current = null;
      }
      if (keepPolling) scheduler.schedule(poll, 1_000);
    };
    scheduler.schedule(poll, 1_000);
    return () => {
      controller?.abort();
      scheduler.dispose();
    };
  }, [accept, invoke, shouldPoll]);

  const readSnapshot = async (endpoint) => {
    const checkLatest = endpoint === 'update.check';
    if (!mounted.current || busy.current || (checkLatest && (activeJob || restartRequired))) return;
    busy.current = true;
    setAction(checkLatest ? 'checking' : 'status');
    setError(null);
    if (checkLatest) {
      installRequest.current = null;
      setSnapshot((current) => current
        ? { ...current, canInstall: false, checkId: null, latestVersion: null, checkedAt: null }
        : current);
    }
    const controller = new AbortController();
    readController.current = controller;
    try {
      const next = await invoke(endpoint, {}, controller.signal);
      if (!controller.signal.aborted && mounted.current) {
        if (checkLatest) accept(next);
        else acceptAuthoritative(next);
      }
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setError(presentError(cause));
    } finally {
      if (!controller.signal.aborted && mounted.current) {
        busy.current = false;
        setAction(null);
      }
    }
  };
  const check = () => readSnapshot('update.check');
  const refreshStatus = () => readSnapshot('update.status');

  const install = async () => {
    if (busy.current || !snapshot?.canInstall || !snapshot.checkId) return;
    busy.current = true;
    setAction('starting');
    setError(null);
    if (installRequest.current?.checkId !== snapshot.checkId) {
      installRequest.current = {
        checkId: snapshot.checkId,
        requestId: globalThis.crypto?.randomUUID?.()
          ?? `update-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
    }
    try {
      // Closing this page only aborts reads, never an accepted Host installation.
      const next = await invoke('update.install', installRequest.current);
      if (mounted.current) acceptAuthoritative(next);
    } catch (cause) {
      if (mounted.current) {
        setError(presentError(cause));
        setUncertainInstall(true);
      }
    } finally {
      if (mounted.current) {
        busy.current = false;
        setAction(null);
      }
    }
  };

  const busyAction = action !== null;
  const blocked = BLOCKED_REASONS[snapshot?.blockedReason] ?? ERROR_MESSAGES[snapshot?.blockedReason];
  const canConfirm = snapshot?.canInstall && snapshot.checkId && !activeJob && !restartRequired;
  const versionsDiffer = snapshot && clientVersion && snapshot.runningVersion !== clientVersion;
  const failedJob = ['failed', 'interrupted'].includes(snapshot?.job?.state) && !snapshot.job.recoverable;
  const jobMessage = snapshot?.job?.message;
  const targetVersion = activeJob || restartRequired ? snapshot?.job?.targetVersion : null;
  const historicalTargetVersion = !activeJob && !restartRequired ? snapshot?.job?.targetVersion : null;
  const latestVersion = !activeJob && !restartRequired && !error && snapshot?.checkedAt
    ? snapshot.latestVersion : null;
  const manualCommand = manualUpdateCommand(snapshot);
  const buttonLabel = action === 'checking' ? '检查中…'
    : action === 'starting' || activeJob ? '正在更新…'
      : restartRequired ? '待手动重启'
        : snapshot?.canInstall ? '更新至'
          : '检查更新';
  const buttonDescription = localizeText(buttonLabel) + (buttonLabel === '更新至' ? ` v${snapshot.latestVersion}` : '');

  return h(React.Fragment, null,
    h('span', { className: 'dim-updateAction' },
      h('button', {
        type: 'button',
        className: 'dim-updateButton dim-updateTrigger',
        disabled: busyAction,
        'aria-label': buttonDescription,
        'aria-describedby': tooltipId,
        'aria-haspopup': 'dialog',
        onClick: () => {
          setOpen(true);
          if (restartRequired) void refreshStatus();
          else if (!snapshot?.canInstall && !activeJob && !uncertainInstall) void check();
        },
      }, h('svg', {
        width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 2.3, strokeLinecap: 'round', strokeLinejoin: 'round',
        focusable: 'false', 'aria-hidden': 'true',
      },
      h('path', { d: 'M3 12a9 9 0 0 1 15.36-6.36L21 8' }),
      h('path', { d: 'M21 3v5h-5' }),
      h('path', { d: 'M21 12a9 9 0 0 1-15.36 6.36L3 16' }),
      h('path', { d: 'M8 16H3v5' }))),
      h('span', { id: tooltipId, className: 'dim-updateTooltip', role: 'tooltip' }, buttonDescription)),
    open ? h(UpdateDialog, { onClose: () => setOpen(false) },
      h('div', { className: 'dim-updateBody' },
        h('dl', { className: 'dim-updateVersions' },
          h('dt', null, '运行版本'), h('dd', null, `v${snapshot?.runningVersion ?? clientVersion}`),
          snapshot?.installedVersion && snapshot.installedVersion !== snapshot.runningVersion
            ? h(React.Fragment, null,
                h('dt', null, '已安装版本'), h('dd', null, `v${snapshot.installedVersion}`)) : null,
          targetVersion ? h(React.Fragment, null,
            h('dt', null, '目标版本'), h('dd', null, `v${targetVersion}`)) : null,
          latestVersion ? h(React.Fragment, null,
            h('dt', null, '最新版本'), h('dd', null, `v${latestVersion}`)) : null,
          historicalTargetVersion ? h(React.Fragment, null,
            h('dt', null, '上次更新目标'), h('dd', null, `v${historicalTargetVersion}`)) : null,
          h('dt', null, '目标 profile'), h('dd', null, snapshot?.profileName ?? '无法确认')),
        h('div', {
          className: `dim-updateStatus${error || failedJob ? ' dim-updateStatusError' : ''}`,
          role: 'status',
          'aria-live': 'polite',
          'aria-atomic': 'true',
        },
          h('strong', null, summary(snapshot, action, error)),
          activeJob || action === 'starting'
            ? h('p', null, '关闭窗口不会取消安装。请勿同时在其他窗口管理此 profile 的插件。') : null,
          restartRequired ? h('p', null, BLOCKED_REASONS['pending-restart']) : null,
          failedJob && jobMessage ? h('p', null,
            BLOCKED_REASONS[jobMessage] ?? ERROR_MESSAGES[jobMessage] ?? jobMessage) : null),
        error ? h('p', { className: 'dim-updateError', role: 'alert' }, error) : null,
        blocked && !restartRequired ? h('p', { className: 'dim-updateHint' }, blocked) : null,
        versionsDiffer && !restartRequired ? h('p', { className: 'dim-updateHint' }, '页面版本与运行版本不同，请手动刷新页面；若仍不一致，请手动重启 Harness 或 Desktop。') : null,
        canConfirm ? h('p', { className: 'dim-updateHint' },
          '请在机器人空闲时安装；安装会修改当前 profile 的依赖，完成后需手动重启。') : null,
        h('aside', { className: 'dim-updateHint', 'aria-label': 'DSH 版本兼容说明' },
          h('strong', null, 'DSH 版本兼容说明'),
          h('p', { className: 'dim-updateManualHint' }, 'dsh-im 4.25.0 支持到 DSH v0.1.6-alpha.2。'),
          h('p', { className: 'dim-updateManualHint' }, 'dsh-im 4.39.0 仅支持 DSH 0.2.0-rc.2。'),
          h('p', { className: 'dim-updateManualHint' }, 'dsh-im 5.0.0 仅支持 DSH 0.2.1-rc.2。')),
        h(ManualUpdateCommand, {
          key: manualCommand ?? 'unavailable', command: manualCommand,
          disabled: busyAction || activeJob || uncertainInstall,
          sourceInstall: snapshot?.sourceInstall || snapshot?.blockedReason === 'source-install',
          desktop: snapshot?.environmentKind === 'desktop',
        })),
      h('footer', { className: 'dim-updateFooter' },
        h('button', { type: 'button', className: 'dim-updateButton', onClick: () => setOpen(false) }, '关闭'),
        restartRequired || !activeJob ? h('button', {
          type: 'button', className: 'dim-updateButton', disabled: busyAction,
          onClick: (event) => {
            retainDialogFocus(event);
            void (restartRequired ? refreshStatus() : check());
          },
        }, restartRequired ? '刷新状态' : '重新检查') : null,
        canConfirm ? h('button', {
          type: 'button', className: 'dim-updateButton dim-updatePrimary', disabled: busyAction,
          onClick: (event) => {
            retainDialogFocus(event);
            void install();
          },
        }, '安装更新') : null)) : null);
}
