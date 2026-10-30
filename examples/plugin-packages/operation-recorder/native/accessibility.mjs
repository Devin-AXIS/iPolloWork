import koffi from 'koffi';

const label = value => typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').trim().slice(0, 200) : '';
const pointer = buffer => buffer.readBigUInt64LE() || null;
const rectangle = (x, y, width, height) => ({ x, y, width, height });

export function relativePosition(target, window) {
  if (!target || !window || window.width <= 0 || window.height <= 0 || target.width <= 0 || target.height <= 0) return undefined;
  const x = (target.x + target.width / 2 - window.x) / window.width;
  const y = (target.y + target.height / 2 - window.y) / window.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return undefined;
  return [['左上方', '上方', '右上方'], ['左侧', '中央', '右侧'], ['左下方', '下方', '右下方']][Math.min(2, Math.floor(y * 3))][Math.min(2, Math.floor(x * 3))];
}

// Only structural parents describe location. No text/value interface is read.
export function collectContext(api, element, app) {
  const held = [];
  try {
    const target = element ? api.metadata(element) : { role: 'unknown' };
    const parents = [];
    let current = element;
    const seen = new Set();
    for (let depth = 0; current && depth < 12; depth++) {
      const next = api.parent(current);
      if (!next) break;
      held.push(next);
      if (seen.has(next)) break;
      seen.add(next);
      const meta = api.metadata(next, true);
      parents.push({ ...meta, rectangle: api.bounds(next) });
      current = next;
      if (/^(?:Window|AXWindow|frame)$/i.test(meta.role) || meta.name && meta.name === app.window) break;
    }
    const window = parents.find(parent => /^(?:Window|AXWindow|frame)$/i.test(parent.role)) || parents.find(parent => /^dialog$/i.test(parent.role));
    const page = /document|webarea/i.test(target.role) ? target : parents.find(parent => /document|webarea/i.test(parent.role));
    const pageTitle = page?.name || window?.name || app.window;
    const ancestors = parents.filter(parent => parent.name && parent.name !== app.window && /pane|group|toolbar|menubar|menu|navigation|landmark|dialog|form|tab|list|table|grid|tree/i.test(parent.role)).reverse().map(({ role, name }) => ({ role, name })).slice(-8);
    const position = relativePosition(element && api.bounds(element), window?.rectangle || app.rectangle);
    return {
      ...app,
      ...(window?.name ? { window: window.name } : {}),
      ...(pageTitle ? { page: { title: pageTitle } } : {}),
      target: { role: target.role, ...(target.name ? { name: target.name } : {}), ...(target.automationId ? { automationId: target.automationId } : {}), ...(ancestors.length ? { ancestors } : {}), ...(position ? { position } : {}) },
      secret: target.secret === true,
      writable: target.writable === true,
    };
  } finally { for (const parent of held) api.release(parent); }
}

function windows() {
  const user = koffi.load('user32.dll');
  const kernel = koffi.load('kernel32.dll');
  const ole = koffi.load('ole32.dll');
  const automation = koffi.load('oleaut32.dll');
  const security = koffi.load('advapi32.dll');
  const POINT = koffi.struct('RecorderPoint', { x: 'int32', y: 'int32' });
  const RECT = koffi.struct('RecorderRect', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  const foreground = user.func('void * __stdcall GetForegroundWindow()');
  const windowPID = user.func('uint32 __stdcall GetWindowThreadProcessId(void *window, _Out_ uint32 *pid)');
  const windowText = user.func('int __stdcall GetWindowTextW(void *window, _Out_ uint16 *text, int maximum)');
  const windowRect = user.func('int __stdcall GetWindowRect(void *window, _Out_ RecorderRect *rect)');
  const inputDesktop = user.func('void * __stdcall OpenInputDesktop(uint32 flags, int inherit, uint32 access)');
  const closeDesktop = user.func('int __stdcall CloseDesktop(void *desktop)');
  const objectName = user.func('int __stdcall GetUserObjectInformationW(void *handle, int index, _Out_ void *value, uint32 length, _Out_ uint32 *needed)');
  const station = user.func('void * __stdcall GetProcessWindowStation()');
  const threadDesktop = user.func('void * __stdcall GetThreadDesktop(uint32 thread)');
  const threadID = kernel.func('uint32 __stdcall GetCurrentThreadId()');
  const openProcess = kernel.func('void * __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)');
  const closeHandle = kernel.func('int __stdcall CloseHandle(void *handle)');
  const processImage = kernel.func('int __stdcall QueryFullProcessImageNameW(void *process, uint32 flags, _Out_ uint16 *path, _Inout_ uint32 *length)');
  const currentProcess = kernel.func('void * __stdcall GetCurrentProcess()');
  const openToken = security.func('int __stdcall OpenProcessToken(void *process, uint32 access, _Out_ void **token)');
  const tokenInfo = security.func('int __stdcall GetTokenInformation(void *token, int kind, _Out_ void *value, uint32 length, _Out_ uint32 *needed)');
  const sidCount = security.func('uint8 * __stdcall GetSidSubAuthorityCount(void *sid)');
  const sidAuthority = security.func('uint32 * __stdcall GetSidSubAuthority(void *sid, uint32 index)');
  const initialize = ole.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 flags)');
  const uninitialize = ole.func('void __stdcall CoUninitialize()');
  const create = ole.func('int32 __stdcall CoCreateInstance(void *clsid, void *outer, uint32 context, void *iid, _Out_ void **instance)');
  const stringLength = automation.func('uint32 __stdcall SysStringLen(void *value)');
  const freeString = automation.func('void __stdcall SysFreeString(void *value)');
  const signatures = {
    release: koffi.proto('uint32 __stdcall RecorderRelease(void *self)'),
    pointer: koffi.proto('int32 __stdcall RecorderPointer(void *self, _Out_ void **value)'),
    element: koffi.proto('int32 __stdcall RecorderElement(void *self, void *element, _Out_ void **value)'),
    point: koffi.proto('int32 __stdcall RecorderAtPoint(void *self, RecorderPoint point, _Out_ void **value)'),
    integer: koffi.proto('int32 __stdcall RecorderInteger(void *self, _Out_ int32 *value)'),
    bounds: koffi.proto('int32 __stdcall RecorderBounds(void *self, _Out_ RecorderRect *value)'),
    timeout: koffi.proto('int32 __stdcall RecorderTimeout(void *self, uint32 value)'),
  };
  function invoke(object, slot, signature, ...args) {
    const table = koffi.decode(object, 'void *');
    return koffi.call(koffi.decode(table, slot * 8, 'void *'), signatures[signature], object, ...args);
  }
  function check(result) { if (result < 0) throw new Error(`Windows UI Automation 查询失败（HRESULT 0x${(result >>> 0).toString(16)}）。`); }
  function getPointer(object, slot, signature = 'pointer', ...args) {
    const out = Buffer.alloc(8);
    check(invoke(object, slot, signature, ...args, out));
    return pointer(out);
  }
  function integer(object, slot) { const out = [0]; check(invoke(object, slot, 'integer', out)); return out[0]; }
  function string(object, slot) {
    const value = getPointer(object, slot);
    if (!value) return '';
    try { return label(String.fromCharCode(...koffi.decode(value, 'uint16', Math.min(stringLength(value), 200)))); }
    finally { freeString(value); }
  }
  function desktopName(handle) {
    const out = Buffer.alloc(256);
    if (!handle || !objectName(handle, 2, out, out.length, [0])) throw new Error('Windows 桌面不可访问。');
    return out.toString('utf16le').split('\0')[0];
  }
  function desktopCheck() {
    if (desktopName(station()).toLowerCase() !== 'winsta0') throw new Error('请从已解锁的 Windows 用户桌面启动录制器。');
    const desktop = inputDesktop(0, 0, 1);
    if (!desktop) throw new Error('Windows 已锁屏或进入受保护的桌面，录制已停止。');
    try {
      if (desktopName(desktop).toLowerCase() !== desktopName(threadDesktop(threadID())).toLowerCase()) throw new Error('Windows 已切换到锁屏或 UAC 桌面，录制已停止。');
    } finally { closeDesktop(desktop); }
  }
  function integrity(process) {
    const out = Buffer.alloc(8);
    if (!openToken(process, 8, out)) throw new Error('无法检查 Windows 应用权限等级。');
    const token = pointer(out);
    try {
      const needed = [0];
      tokenInfo(token, 25, null, 0, needed);
      if (needed[0] < 16 || needed[0] > 4096) throw new Error('Windows 权限等级信息无效。');
      const buffer = Buffer.alloc(needed[0]);
      if (!tokenInfo(token, 25, buffer, buffer.length, needed)) throw new Error('Windows 权限等级不可访问。');
      const sid = pointer(buffer);
      if (!sid) throw new Error('Windows 权限标识无效。');
      const count = koffi.decode(sidCount(sid), 'uint8');
      if (!count) throw new Error('Windows 权限标识无效。');
      return koffi.decode(sidAuthority(sid, count - 1), 'uint32');
    } finally { closeHandle(token); }
  }
  desktopCheck();
  check(initialize(null, 0));
  let client;
  let walker;
  try {
    const out = Buffer.alloc(8);
    // CLSID_CUIAutomation8 / IID_IUIAutomation2: bounded provider timeouts.
    check(create(Buffer.from('33d32ae25fb20c4683d00581107395c9', 'hex'), null, 1, Buffer.from('ff3a72349d0cd04998967ab52df8cd8a', 'hex'), out));
    client = pointer(out);
    if (!client) throw new Error('Windows 未返回 UI Automation 客户端。');
    check(invoke(client, 61, 'timeout', 350));
    check(invoke(client, 63, 'timeout', 350));
    walker = getPointer(client, 14);
    const ownIntegrity = integrity(currentProcess());
    const roles = { 50000: 'Button', 50002: 'CheckBox', 50003: 'ComboBox', 50004: 'TextField', 50005: 'Hyperlink', 50007: 'ListItem', 50008: 'List', 50009: 'Menu', 50010: 'MenuBar', 50011: 'MenuItem', 50013: 'RadioButton', 50018: 'Tab', 50019: 'TabItem', 50020: 'Text', 50021: 'ToolBar', 50023: 'Tree', 50024: 'TreeItem', 50025: 'Custom', 50028: 'DataGrid', 50029: 'DataItem', 50030: 'Document', 50031: 'SplitButton', 50032: 'Window', 50033: 'Pane', 50036: 'Table', 50040: 'AppBar' };
    const api = {
      release: object => { if (object) invoke(object, 2, 'release'); },
      parent: object => getPointer(walker, 3, 'element', object),
      bounds: object => { const rect = {}; check(invoke(object, 43, 'bounds', rect)); return rectangle(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top); },
      metadata: (object, context = false) => {
        const type = integer(object, 21);
        const secret = integer(object, 35) !== 0;
        const writable = secret || [50003, 50004].includes(type);
        let name = secret ? '受保护的输入框' : writable ? '' : string(object, 23);
        if (writable && !secret) {
          const labelledBy = getPointer(object, 44);
          if (labelledBy) { try { if (![50003, 50004].includes(integer(labelledBy, 21))) name = string(labelledBy, 23); } finally { api.release(labelledBy); } }
          // Chromium's Edit provider separates the accessible label (Name)
          // from the editable content (Value). Custom providers stay excluded.
          if (!name && string(object, 40) === 'Chrome') name = string(object, 23);
          if (!name) name = '未命名输入框';
        }
        return { role: roles[type] || 'unknown', name, secret, writable: writable || type === 50030 && !context, automationId: string(object, 29) };
      },
    };
    return {
      backend: 'nodejs-uiohook-windows-uia',
      permissionHelp: '请解锁 Windows 桌面，并以相同权限等级运行目标应用和 iPolloWork；不自动申请管理员权限。',
      check: desktopCheck,
      capture(event) {
        desktopCheck();
        const window = foreground();
        if (!window) return { target: { role: 'unknown' } };
        const pid = [0]; windowPID(window, pid);
        const process = openProcess(0x1000, 0, pid[0]);
        if (!process) throw new Error('目标 Windows 应用不可访问，请检查其权限等级。');
        let app;
        try {
          if (integrity(process) > ownIntegrity) throw new Error('目标应用权限高于录制器，请以相同权限等级运行。');
          const path = Buffer.alloc(2048);
          if (!processImage(process, 0, path, [1024])) throw new Error('无法识别目标 Windows 应用。');
          const executable = path.toString('utf16le').split('\0')[0].split('\\').at(-1);
          const title = Buffer.alloc(1024); windowText(window, title, 512);
          const rect = {}; windowRect(window, rect);
          app = { app: executable.replace(/\.exe$/i, ''), bundleId: `windows:${executable.toLowerCase()}`, window: label(title.toString('utf16le').split('\0')[0]), rectangle: rectangle(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top) };
        } finally { closeHandle(process); }
        const element = event.point ? getPointer(client, 7, 'point', event.point) : getPointer(client, 8);
        try {
          if (element && integer(element, 20) !== pid[0]) return { ...app, target: { role: 'unknown' } };
          return collectContext(api, element, app);
        } finally { api.release(element); }
      },
      close() { api.release(walker); api.release(client); uninitialize(); },
    };
  } catch (error) {
    if (walker) invoke(walker, 2, 'release');
    if (client) invoke(client, 2, 'release');
    uninitialize(); throw error;
  }
}

function macOS(requestPermissions) {
  const ax = koffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices');
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const proc = koffi.load('/usr/lib/libproc.dylib');
  const release = cf.func('void CFRelease(void *object)');
  const cfString = cf.func('void *CFStringCreateWithCString(void *allocator, const char *value, uint32 encoding)');
  const cfText = cf.func('bool CFStringGetCString(void *value, _Out_ char *buffer, long length, uint32 encoding)');
  const typeID = cf.func('ulong CFGetTypeID(void *object)');
  const stringID = cf.func('ulong CFStringGetTypeID()');
  const trusted = ax.func('bool AXIsProcessTrusted()');
  const listenAllowed = ax.func('bool CGPreflightListenEventAccess()');
  if (requestPermissions) {
    const key = cfString(null, 'AXTrustedCheckOptionPrompt', 0x08000100);
    const dictionary = cf.func('void *CFDictionaryCreate(void *allocator, void **keys, void **values, long count, void *keyCallbacks, void *valueCallbacks)')(null, [key], [koffi.decode(cf.symbol('kCFBooleanTrue', 'void *'), 'void *')], 1, null, null);
    try { ax.func('bool AXIsProcessTrustedWithOptions(void *options)')(dictionary); ax.func('bool CGRequestListenEventAccess()')(); }
    finally { release(dictionary); release(key); }
  }
  if (!trusted() || !listenAllowed()) throw new Error('请在「系统设置 → 隐私与安全性 → 辅助功能 / 输入监控」允许运行录制器的 Node.js 或 iPolloWork，再重新检查。');
  const system = ax.func('void *AXUIElementCreateSystemWide()')();
  if (!system) throw new Error('macOS 未提供辅助功能客户端。');
  if (ax.func('int AXUIElementSetMessagingTimeout(void *element, float seconds)')(system, 0.35) !== 0) { release(system); throw new Error('无法设置 macOS 辅助功能查询超时。'); }
  const copyAttribute = ax.func('int AXUIElementCopyAttributeValue(void *element, void *attribute, _Out_ void **value)');
  const hit = ax.func('int AXUIElementCopyElementAtPosition(void *element, float x, float y, _Out_ void **value)');
  const pidOf = ax.func('int AXUIElementGetPid(void *element, _Out_ int *pid)');
  const attributes = new Map();
  function attribute(element, name) {
    if (!element) return null;
    if (!attributes.has(name)) attributes.set(name, cfString(null, name, 0x08000100));
    const out = Buffer.alloc(8);
    return copyAttribute(element, attributes.get(name), out) === 0 ? pointer(out) : null;
  }
  function string(element, name) {
    const value = attribute(element, name);
    if (!value) return '';
    try { const buffer = Buffer.alloc(2048); return typeID(value) === stringID() && cfText(value, buffer, buffer.length, 0x08000100) ? label(buffer.toString('utf8').split('\0')[0]) : ''; }
    finally { release(value); }
  }
  const valueGet = ax.func('bool AXValueGetValue(void *value, int type, _Out_ void *result)');
  function pair(element, name, type) {
    const value = attribute(element, name);
    if (!value) return undefined;
    try { const out = Buffer.alloc(16); return valueGet(value, type, out) ? [out.readDoubleLE(), out.readDoubleLE(8)] : undefined; }
    finally { release(value); }
  }
  const api = {
    release: object => { if (object) release(object); },
    parent: element => attribute(element, 'AXParent'),
    bounds: element => { const position = pair(element, 'AXPosition', 1); const size = pair(element, 'AXSize', 2); return position && size ? rectangle(...position, ...size) : undefined; },
    metadata(element) {
      const role = string(element, 'AXRole');
      const secret = /secure/i.test(string(element, 'AXSubrole'));
      const writable = secret || /textfield|textarea|combobox/i.test(role);
      // AXValue is deliberately never queried, including editable AXTitle.
      const name = secret ? '受保护的输入框' : (writable ? string(element, 'AXDescription') || string(element, 'AXPlaceholderValue') : string(element, 'AXTitle') || string(element, 'AXDescription'));
      return { role, name: writable && !name ? '未命名输入框' : name, secret, writable };
    },
  };
  const processName = proc.func('int proc_name(int pid, _Out_ char *buffer, uint32 length)');
  return {
    backend: 'nodejs-uiohook-macos-ax',
    permissionHelp: '在 macOS「系统设置 → 隐私与安全性」授权辅助功能和输入监控。',
    check() { if (!trusted() || !listenAllowed()) throw new Error('macOS 录制权限已被撤销，请重新授权。'); },
    capture(event) {
      this.check();
      const application = attribute(system, 'AXFocusedApplication');
      if (!application) return { target: { role: 'unknown' } };
      let element;
      try {
        const pid = [0]; pidOf(application, pid);
        const name = Buffer.alloc(512); processName(pid[0], name, name.length);
        if (event.point) { const out = Buffer.alloc(8); if (hit(system, event.point.x, event.point.y, out) === 0) element = pointer(out); }
        else element = attribute(application, 'AXFocusedUIElement');
        const window = attribute(application, 'AXFocusedWindow');
        try {
          const title = window ? string(window, 'AXTitle') : '';
          return collectContext(api, element, { app: label(name.toString('utf8').split('\0')[0]), window: title, ...(title ? { page: { title } } : {}), rectangle: window && api.bounds(window) });
        } finally { api.release(window); }
      } finally { api.release(element); release(application); }
    },
    close() { for (const value of attributes.values()) release(value); release(system); },
  };
}

function linux() {
  if (process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE?.toLowerCase() === 'wayland') throw new Error('Wayland/XWayland 无法被动录制全桌面，请使用 X11 或导入 Chrome Recorder JSON。');
  if (!/^(?:unix\/)?:\d+(?:\.\d+)?$/.test(process.env.DISPLAY || '')) throw new Error('请从本机 X11 用户桌面启动录制器。');
  const atspi = koffi.load('libatspi.so.0');
  const glib = koffi.load('libglib-2.0.so.0');
  const gobject = koffi.load('libgobject-2.0.so.0');
  const x11 = koffi.load('libX11.so.6');
  const xOpen = x11.func('void *XOpenDisplay(const char *name)');
  const xClose = x11.func('int XCloseDisplay(void *display)');
  const xQuery = x11.func('int XQueryExtension(void *display, const char *name, _Out_ int *opcode, _Out_ int *event, _Out_ int *error)');
  const display = xOpen(null);
  if (!display) throw new Error('无法连接当前 X11 桌面。');
  try {
    if (xQuery(display, 'XWAYLAND', [0], [0], [0])) throw new Error('当前 DISPLAY 是 XWayland，无法录制全桌面。');
    if (!xQuery(display, 'RECORD', [0], [0], [0])) throw new Error('当前 X11 服务没有 RECORD 扩展。');
  } finally { xClose(display); }
  if (atspi.func('int atspi_init()')() !== 0) throw new Error('无法连接 Linux AT-SPI 辅助功能总线。');
  atspi.func('void atspi_set_timeout(int timeout, int startup)')(300, 800);
  const unref = gobject.func('void g_object_unref(void *object)');
  const free = glib.func('void g_free(void *value)');
  const freeError = glib.func('void g_error_free(void *error)');
  const mainIteration = glib.func('int g_main_context_iteration(void *context, int blocking)');
  const freeArray = glib.func('void *g_array_free(void *array, int freeSegment)');
  const ARRAY = koffi.struct('RecorderRelations', { data: 'void *', length: 'uint32' });
  const relationType = atspi.func('int atspi_relation_get_relation_type(void *relation)');
  const relationCount = atspi.func('int atspi_relation_get_n_targets(void *relation)');
  const relationTarget = atspi.func('void *atspi_relation_get_target(void *relation, int index)');
  const functions = {
    parent: atspi.func('void *atspi_accessible_get_parent(void *element, _Out_ void **error)'),
    role: atspi.func('void *atspi_accessible_get_role_name(void *element, _Out_ void **error)'),
    name: atspi.func('void *atspi_accessible_get_name(void *element, _Out_ void **error)'),
    relations: atspi.func('void *atspi_accessible_get_relation_set(void *element, _Out_ void **error)'),
    count: atspi.func('int atspi_accessible_get_child_count(void *element, _Out_ void **error)'),
    child: atspi.func('void *atspi_accessible_get_child_at_index(void *element, int index, _Out_ void **error)'),
    application: atspi.func('void *atspi_accessible_get_application(void *element, _Out_ void **error)'),
    component: atspi.func('void *atspi_accessible_get_component_iface(void *element)'),
    hit: atspi.func('void *atspi_component_get_accessible_at_point(void *component, int x, int y, int coordinates, _Out_ void **error)'),
    extents: atspi.func('void *atspi_component_get_extents(void *component, int coordinates, _Out_ void **error)'),
  };
  const states = atspi.func('void *atspi_accessible_get_state_set(void *element)');
  const contains = atspi.func('int atspi_state_set_contains(void *states, int state)');
  const desktop = atspi.func('void *atspi_get_desktop(int index)')(0);
  function query(name, ...args) {
    const error = Buffer.alloc(8);
    const result = functions[name](...args, error);
    const failure = pointer(error);
    if (failure) { freeError(failure); throw new Error(`Linux AT-SPI ${name} 查询失败。`); }
    return result;
  }
  function string(name, element) {
    const value = query(name, element);
    if (!value) return '';
    try { return label(koffi.decode(value, 'str')); } finally { free(value); }
  }
  function hasState(element, state) { const set = states(element); if (!set) return false; try { return contains(set, state) !== 0; } finally { unref(set); } }
  function fieldLabel(element) {
    const array = query('relations', element);
    if (!array) return '';
    const { data, length } = koffi.decode(array, ARRAY);
    try {
      for (let index = 0; index < Math.min(length, 32); index++) {
        const relation = koffi.decode(data, index * 8, 'void *');
        if (relationType(relation) !== 2) continue; // ATSPI_RELATION_LABELLED_BY
        for (let target = 0; target < Math.min(relationCount(relation), 8); target++) {
          const labelledBy = relationTarget(relation, target);
          if (!labelledBy) continue;
          try { if (!hasState(labelledBy, 7) && !/password/i.test(string('role', labelledBy))) { const name = string('name', labelledBy); if (name) return name; } }
          finally { unref(labelledBy); }
        }
      }
      return '';
    } finally {
      for (let index = 0; index < length; index++) unref(koffi.decode(data, index * 8, 'void *'));
      freeArray(array, 1);
    }
  }
  const api = {
    release: object => { if (object) unref(object); },
    parent: element => query('parent', element),
    metadata(element) {
      const role = string('role', element);
      const secret = /password/i.test(role);
      const writable = secret || hasState(element, 7);
      return { role: writable ? secret ? 'SecureTextField' : 'TextField' : role, name: secret ? '受保护的输入框' : writable ? fieldLabel(element) || '未命名输入框' : string('name', element), secret, writable };
    },
    bounds(element) {
      const component = functions.component(element);
      if (!component) return undefined;
      try { const value = query('extents', component, 0); if (!value) return undefined; try { const rect = koffi.decode(value, koffi.struct({ x: 'int32', y: 'int32', width: 'int32', height: 'int32' })); return rect; } finally { free(value); } }
      finally { unref(component); }
    },
  };
  try { if (!desktop || query('count', desktop) === 0) throw new Error('Linux AT-SPI 未提供可访问的桌面应用。'); }
  catch (error) { api.release(desktop); atspi.func('int atspi_exit()')(); throw error; }
  function focused() {
    const pending = [];
    let found;
    try {
      for (let index = 0; index < Math.min(query('count', desktop), 64); index++) { const element = query('child', desktop, index); if (element) pending.push({ element, depth: 0 }); }
      const deadline = performance.now() + 700;
      for (let examined = 0; pending.length && examined < 256 && performance.now() < deadline; examined++) {
        const { element, depth } = pending.pop();
        try {
          if (hasState(element, 12)) { found = element; break; }
          if (depth < 12) for (let index = 0; index < Math.min(query('count', element), 32); index++) { const child = query('child', element, index); if (child) pending.push({ element: child, depth: depth + 1 }); }
        } finally { if (element !== found) unref(element); }
      }
      return found;
    } finally { for (const { element } of pending) unref(element); }
  }
  function atPoint(point) {
    for (let index = 0; index < Math.min(query('count', desktop), 64); index++) {
      const application = query('child', desktop, index);
      if (!application) continue;
      try {
        for (let child = 0; child < Math.min(query('count', application), 32); child++) {
          let element = query('child', application, child);
          if (!element) continue;
          try {
            // A background window at the same screen coordinates must never
            // supply the target identity for a foreground click.
            if (!hasState(element, 1)) continue; // ATSPI_STATE_ACTIVE
            const bounds = api.bounds(element);
            if (!bounds || point.x < bounds.x || point.y < bounds.y || point.x > bounds.x + bounds.width || point.y > bounds.y + bounds.height) continue;
            for (let depth = 0; depth < 12; depth++) {
              const component = functions.component(element);
              if (!component) break;
              let next;
              try { next = query('hit', component, point.x, point.y, 0); } finally { unref(component); }
              if (!next || next === element) { api.release(next); break; }
              unref(element); element = next;
            }
            const selected = element; element = null; return selected;
          } finally { api.release(element); }
        }
      } finally { unref(application); }
    }
    return undefined;
  }
  return {
    backend: 'nodejs-uiohook-x11-atspi',
    permissionHelp: '需要当前用户的 X11 RECORD 扩展、libatspi、libXtst 和已启用的桌面辅助功能总线。',
    check() { for (let count = 0; count < 32 && mainIteration(null, 0); count++) { /* Pump bounded AT-SPI updates. */ } },
    capture(event) {
      this.check();
      const element = event.point ? atPoint(event.point) : focused();
      if (!element) return { target: { role: 'unknown' } };
      try {
        const application = query('application', element);
        try { return collectContext(api, element, { app: application ? string('name', application) : '' }); }
        finally { api.release(application); }
      } finally { unref(element); }
    },
    close() { unref(desktop); atspi.func('int atspi_exit()')(); },
  };
}

export function createAccessibility(platform = process.platform, requestPermissions = false) {
  if (!['x64', 'arm64'].includes(process.arch)) throw new Error(`没有 ${process.arch} 的桌面采集模块。`);
  if (platform === 'win32') return windows();
  if (platform === 'darwin') return macOS(requestPermissions);
  if (platform === 'linux') return linux();
  throw new Error(`没有 ${platform} 的桌面采集后端。`);
}
