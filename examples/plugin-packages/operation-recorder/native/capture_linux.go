//go:build linux

package main

import (
	"context"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/jezek/xgb"
	"github.com/jezek/xgb/record"
	"github.com/jezek/xgb/xproto"
)

const linuxPacketLimit = 1 << 20
const atspiInterface = "org.a11y.atspi.Accessible"
const atspiRegistry = "org.a11y.atspi.Registry"
const atspiFocusEvent = "object:state-changed:focused"

func init() {
	// xgb logs normal socket closure as an unrecoverable read failure. The helper
	// has explicit bounded failure channels, so upstream diagnostics must not
	// turn a successful stop/probe into a host-visible recording error.
	xgb.Logger = log.New(io.Discard, "", 0)
}

// Native Wayland and its XWayland compatibility server cannot provide a global
// passive recorder. A DISPLAY alone must never be reported as desktop support.
func linuxSessionType(session, wayland, display string) (string, error) {
	if strings.EqualFold(session, "wayland") || wayland != "" {
		return "wayland", errors.New("Wayland/XWayland 无法提供全桌面被动录制，请使用 X11 会话或导入 Chrome Recorder JSON")
	}
	if session != "" && !strings.EqualFold(session, "x11") {
		return session, errors.New("当前不是受支持的 X11 桌面会话")
	}
	if display == "" {
		return "headless", errors.New("当前没有 X11 DISPLAY，无法录制桌面操作")
	}
	return "x11", nil
}

func linuxDisplayNumber(display string) (string, error) {
	display = strings.TrimPrefix(display, "unix/")
	if !strings.HasPrefix(display, ":") {
		return "", errors.New("仅支持本机 X11 Unix socket，不能录制远程 DISPLAY")
	}
	number := strings.SplitN(display[1:], ".", 2)[0]
	n, err := strconv.Atoi(number)
	if err != nil || n < 0 || n > 65535 {
		return "", errors.New("X11 DISPLAY 格式无效")
	}
	if _, err := linuxDisplayScreen(display); err != nil {
		return "", err
	}
	return strconv.Itoa(n), nil
}

func linuxDisplayScreen(display string) (int, error) {
	parts := strings.SplitN(strings.TrimPrefix(display, "unix/"), ".", 2)
	if len(parts) == 1 {
		return 0, nil
	}
	screen, err := strconv.Atoi(parts[1])
	if err != nil || screen < 0 || screen > 65535 {
		return 0, errors.New("X11 DISPLAY screen 格式无效")
	}
	return screen, nil
}

// Authentication bytes never appear in errors, output, or operation objects.
// The bounded Xauthority reader selects a local matching MIT cookie; xgb still
// implements the actual authenticated connection setup.
func linuxAuthority(reader io.Reader, display, hostname string) ([]byte, error) {
	r := io.LimitReader(reader, linuxPacketLimit)
	field := func() ([]byte, error) {
		var size uint16
		if err := binary.Read(r, binary.BigEndian, &size); err != nil {
			return nil, err
		}
		if size > 4096 {
			return nil, errors.New("Xauthority 字段超出限制")
		}
		value := make([]byte, size)
		_, err := io.ReadFull(r, value)
		return value, err
	}
	for count := 0; count < 4096; count++ {
		var family uint16
		if err := binary.Read(r, binary.BigEndian, &family); err != nil {
			break
		}
		address, err := field()
		if err != nil {
			break
		}
		number, err := field()
		if err != nil {
			break
		}
		name, err := field()
		if err != nil {
			break
		}
		cookie, err := field()
		if err != nil {
			break
		}
		if (family == 65535 || (family == 256 && string(address) == hostname)) &&
			(string(number) == "" || string(number) == display) && string(name) == "MIT-MAGIC-COOKIE-1" && len(cookie) == 16 {
			return cookie, nil
		}
	}
	return nil, errors.New("没有找到当前本机 X11 会话的认证凭据，请从同一桌面用户会话启动插件")
}

type linuxRecordPacket struct {
	bytes []byte
	at    time.Time
}

// xgb's generated EnableContext cookie accepts one reply; RECORD is a stream
// with the same sequence number. This adapter forwards the first reply to xgb,
// intercepts only subsequent stream replies, and leaves all other X11 traffic
// unchanged. It reuses xgb's authentication, framing, and extension requests.
type linuxRecordWire struct {
	net.Conn
	ctx            context.Context
	mu             sync.Mutex
	setup          bool
	authWritten    bool
	writeRemaining int
	sequence       uint16
	opcode         byte
	enableSequence uint16
	enabled        bool
	initialSent    bool
	buffer         []byte
	packets        chan linuxRecordPacket
	failures       chan error
}

func newLinuxRecordWire(ctx context.Context, conn net.Conn) *linuxRecordWire {
	return &linuxRecordWire{Conn: conn, ctx: ctx, packets: make(chan linuxRecordPacket, 256), failures: make(chan error, 1)}
}

func (w *linuxRecordWire) Write(data []byte) (int, error) {
	w.mu.Lock()
	if w.writeRemaining == 0 {
		w.writeRemaining = len(data)
		if w.authWritten {
			w.sequence++
			if len(data) >= 8 && data[0] == w.opcode && w.opcode != 0 && data[1] == 5 {
				w.enableSequence, w.enabled = w.sequence, true
			}
		} else {
			w.authWritten = true
		}
	}
	n, err := w.Conn.Write(data)
	w.writeRemaining -= n
	w.mu.Unlock()
	return n, err
}

func (w *linuxRecordWire) Read(destination []byte) (n int, result error) {
	defer func() {
		if result != nil {
			select {
			case w.failures <- errors.New("X11 录制连接中断，已捕获的流程需要检查"):
			default:
			}
		}
	}()
	for len(w.buffer) == 0 {
		if !w.setup {
			header := make([]byte, 8)
			if _, err := io.ReadFull(w.Conn, header); err != nil {
				return 0, err
			}
			length := int(binary.LittleEndian.Uint16(header[6:8])) * 4
			w.buffer = make([]byte, 8+length)
			copy(w.buffer, header)
			if _, err := io.ReadFull(w.Conn, w.buffer[8:]); err != nil {
				return 0, err
			}
			w.setup = true
			continue
		}
		header := make([]byte, 32)
		if _, err := io.ReadFull(w.Conn, header); err != nil {
			return 0, err
		}
		observed := time.Now()
		length := uint32(0)
		if header[0] == 1 || header[0]&127 == 35 {
			length = binary.LittleEndian.Uint32(header[4:8])
		}
		if length > linuxPacketLimit/4 {
			return 0, errors.New("X11 回复超出录制限制")
		}
		packet := make([]byte, 32+int(length)*4)
		copy(packet, header)
		if _, err := io.ReadFull(w.Conn, packet[32:]); err != nil {
			return 0, err
		}
		w.mu.Lock()
		stream := w.enabled && header[0] == 1 && binary.LittleEndian.Uint16(header[2:4]) == w.enableSequence
		intercept := stream && w.initialSent
		if stream {
			w.initialSent = true
		}
		w.mu.Unlock()
		if intercept {
			select {
			case w.packets <- linuxRecordPacket{packet, observed}:
			case <-w.ctx.Done():
				return 0, w.ctx.Err()
			default:
				return 0, errors.New("录制事件队列已满，请缩短录制并检查遗漏")
			}
			continue
		}
		w.buffer = packet
	}
	n = copy(destination, w.buffer)
	w.buffer = w.buffer[n:]
	return n, nil
}

type linuxXConnection struct {
	conn *xgb.Conn
	wire *linuxRecordWire
}

func openLinuxX11(ctx context.Context) (*linuxXConnection, error) {
	number, err := linuxDisplayNumber(os.Getenv("DISPLAY"))
	if err != nil {
		return nil, err
	}
	path := os.Getenv("XAUTHORITY")
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, errors.New("无法定位 X11 用户认证文件")
		}
		path = filepath.Join(home, ".Xauthority")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, errors.New("无法读取 X11 用户认证文件，请从当前桌面会话启动插件")
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !stat.Mode().IsRegular() || stat.Size() > linuxPacketLimit {
		return nil, errors.New("X11 认证文件无效或超出限制")
	}
	hostname, err := os.Hostname()
	if err != nil {
		return nil, errors.New("无法确定本机 X11 身份")
	}
	cookie, err := linuxAuthority(file, number, hostname)
	if err != nil {
		return nil, err
	}
	dialer := net.Dialer{Timeout: 2 * time.Second}
	connection, err := dialer.DialContext(ctx, "unix", "/tmp/.X11-unix/X"+number)
	if err != nil {
		return nil, errors.New("无法连接当前用户的 X11 桌面")
	}
	connection.SetDeadline(time.Now().Add(2 * time.Second))
	wire := newLinuxRecordWire(ctx, connection)
	x, err := xgb.NewConnNetWithCookieHex(wire, hex.EncodeToString(cookie))
	clear(cookie)
	if err != nil {
		connection.Close()
		return nil, errors.New("X11 桌面认证失败")
	}
	screen, err := linuxDisplayScreen(os.Getenv("DISPLAY"))
	if err != nil || screen >= len(xproto.Setup(x).Roots) {
		wire.Close()
		x.Close()
		return nil, errors.New("X11 DISPLAY screen 不可用")
	}
	x.DefaultScreen = screen
	return &linuxXConnection{x, wire}, nil
}

func (x *linuxXConnection) close() { x.wire.Close(); x.conn.Close() }

func linuxRecordAvailable(x *linuxXConnection) error {
	wayland, err := xproto.QueryExtension(x.conn, 8, "XWAYLAND").Reply()
	if err != nil {
		return errors.New("无法查询 X11 服务能力")
	}
	if wayland != nil && wayland.Present {
		return errors.New("当前 DISPLAY 是 XWayland，无法提供全桌面被动录制")
	}
	if err := record.Init(x.conn); err != nil {
		return errors.New("当前 X11 服务未提供 RECORD 扩展，无法被动录制键鼠")
	}
	version, err := record.QueryVersion(x.conn, 1, 13).Reply()
	if err != nil || version == nil || version.MajorVersion != 1 {
		return errors.New("X11 RECORD 扩展版本不可用")
	}
	return nil
}

func platformCapabilities() Capabilities {
	session, err := linuxSessionType(os.Getenv("XDG_SESSION_TYPE"), os.Getenv("WAYLAND_DISPLAY"), os.Getenv("DISPLAY"))
	caps := Capabilities{Backend: "x11-record-atspi", SessionType: session,
		PermissionHelp: "请在同一桌面用户的 X11 会话运行插件，启用桌面辅助功能和目标应用的 AT-SPI 支持；Wayland 可改用 Chrome Recorder JSON 导入。"}
	if err != nil {
		caps.Reason = err.Error()
		return caps
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	x, err := openLinuxX11(ctx)
	if err != nil {
		caps.Reason = err.Error()
		return caps
	}
	defer x.close()
	if err = linuxRecordAvailable(x); err != nil {
		caps.Reason = err.Error()
		return caps
	}
	caps.Supported, caps.InputMonitoring = true, true
	bus, err := openLinuxAccessibility(ctx, nil)
	if err != nil {
		caps.Reason = "X11 键鼠能力可用，但 AT-SPI 辅助功能总线不可用，无法可靠识别输入控件"
		return caps
	}
	bus.Close()
	caps.Accessibility = true
	return caps
}

type linuxAccessibleRef struct {
	Bus  string
	Path dbus.ObjectPath
}
type linuxFocus struct {
	ref     linuxAccessibleRef
	focused bool
	at      time.Time
}
type linuxSignalHandler struct {
	ctx      context.Context
	events   chan linuxFocus
	failures chan error
}

func (h *linuxSignalHandler) DeliverSignal(iface, name string, signal *dbus.Signal) {
	if iface != "org.a11y.atspi.Event.Object" || name != "StateChanged" || len(signal.Body) < 2 {
		return
	}
	state, ok := signal.Body[0].(string)
	if !ok || state != "focused" {
		return
	}
	detail, ok := signal.Body[1].(int32)
	if !ok {
		return
	}
	// Never read signal any_data, which may carry text or user input.
	event := linuxFocus{linuxAccessibleRef{signal.Sender, signal.Path}, detail != 0, time.Now()}
	select {
	case h.events <- event:
	case <-h.ctx.Done():
	default:
		select {
		case h.failures <- errors.New("辅助功能事件队列已满，录制可能不完整"):
		default:
		}
	}
}

func openLinuxAccessibility(ctx context.Context, handler dbus.SignalHandler) (*dbus.Conn, error) {
	session, err := dbus.ConnectSessionBus(dbus.WithContext(ctx))
	if err != nil {
		return nil, err
	}
	defer session.Close()
	var address string
	if err = session.Object("org.a11y.Bus", "/org/a11y/bus").CallWithContext(ctx, "org.a11y.Bus.GetAddress", 0).Store(&address); err != nil {
		return nil, err
	}
	if !strings.HasPrefix(address, "unix:") {
		return nil, errors.New("辅助功能总线不是本机 Unix socket")
	}
	options := []dbus.ConnOption{dbus.WithContext(ctx)}
	if handler != nil {
		options = append(options, dbus.WithSignalHandler(handler))
	}
	bus, err := dbus.Connect(address, options...)
	if err != nil {
		return nil, err
	}
	var owned bool
	if err = bus.BusObject().CallWithContext(ctx, "org.freedesktop.DBus.NameHasOwner", 0, atspiRegistry).Store(&owned); err != nil || !owned {
		bus.Close()
		return nil, errors.New("AT-SPI Registry 不可用")
	}
	return bus, nil
}

func linuxState(states []uint32, bit uint32) bool {
	return int(bit/32) < len(states) && states[bit/32]&(1<<(bit%32)) != 0
}

func linuxRole(role uint32, editable bool) Target {
	switch role {
	case 40:
		return Target{Role: "password", Name: "受保护的输入框", Secret: true, Writable: true}
	case 61, 77, 79:
		return Target{Role: "textbox", Name: "输入框", Writable: editable}
	case 11:
		return Target{Role: "combobox", Name: "选择框", Writable: true}
	case 12, 52:
		return Target{Role: "spinbutton", Name: "输入控件", Writable: true}
	case 7:
		return Target{Role: "checkbox"}
	case 43, 62:
		return Target{Role: "button"}
	case 44:
		return Target{Role: "radio"}
	case 8, 35, 45, 59:
		return Target{Role: "menuitem"}
	case 37:
		return Target{Role: "tab"}
	case 88:
		return Target{Role: "link"}
	case 16, 23, 69:
		return Target{Role: "window"}
	case 75:
		return Target{Role: "application"}
	default:
		return Target{Role: "unknown"}
	}
}

func linuxSafeNameRole(role string) bool {
	switch role {
	case "button", "checkbox", "radio", "menuitem", "tab", "link", "application":
		return true
	}
	return false
}

type linuxSemantics struct {
	bus        *dbus.Conn
	ref, frame linuxAccessibleRef
	target     Target
	app        string
}

func (s *linuxSemantics) inspect(ctx context.Context, ref linuxAccessibleRef) (Target, uint32, error) {
	if ref.Bus == "" || !ref.Path.IsValid() || ref.Path == "/org/a11y/atspi/null" {
		return Target{Role: "unknown"}, 0, errors.New("无可用语义目标")
	}
	object := s.bus.Object(ref.Bus, ref.Path)
	var role uint32
	if err := object.CallWithContext(ctx, atspiInterface+".GetRole", 0).Store(&role); err != nil {
		return Target{Role: "unknown"}, 0, err
	}
	var states []uint32
	if err := object.CallWithContext(ctx, atspiInterface+".GetState", 0).Store(&states); err != nil {
		return Target{Role: "unknown"}, 0, err
	}
	target := linuxRole(role, linuxState(states, 7))
	if linuxState(states, 7) && !target.Secret {
		target.Writable = true
		if target.Name == "" {
			target.Name = "输入控件"
		}
	}
	if !target.Writable && !target.Secret && linuxSafeNameRole(target.Role) {
		var value dbus.Variant
		if object.CallWithContext(ctx, "org.freedesktop.DBus.Properties.Get", 0, atspiInterface, "Name").Store(&value) == nil {
			if name, ok := value.Value().(string); ok {
				target.Name = label(name)
			}
		}
	}
	return target, role, nil
}

func (s *linuxSemantics) focus(ctx context.Context, event linuxFocus) *Operation {
	if !event.focused {
		if s.ref == event.ref {
			s.ref, s.frame, s.target, s.app = linuxAccessibleRef{}, linuxAccessibleRef{}, Target{Role: "unknown"}, ""
		}
		return nil
	}
	query, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
	defer cancel()
	target, _, err := s.inspect(query, event.ref)
	if err != nil {
		s.ref, s.frame, s.target = linuxAccessibleRef{}, linuxAccessibleRef{}, Target{Role: "unknown"}
		return nil
	}
	s.ref, s.target, s.frame, s.app = event.ref, target, linuxAccessibleRef{}, "X11 应用"
	var appRef linuxAccessibleRef
	if s.bus.Object(event.ref.Bus, event.ref.Path).CallWithContext(query, atspiInterface+".GetApplication", 0).Store(&appRef) == nil {
		app, role, err := s.inspect(query, appRef)
		if err == nil && role == 75 && app.Name != "" {
			s.app = app.Name
		}
	}
	parent := event.ref
	for depth := 0; depth < 12 && query.Err() == nil; depth++ {
		_, role, err := s.inspect(query, parent)
		if err != nil {
			break
		}
		if role == 16 || role == 23 || role == 69 {
			s.frame = parent
			break
		}
		var value dbus.Variant
		if s.bus.Object(parent.Bus, parent.Path).CallWithContext(query, "org.freedesktop.DBus.Properties.Get", 0, atspiInterface, "Parent").Store(&value) != nil {
			break
		}
		var next linuxAccessibleRef
		if dbus.Store([]any{value.Value()}, &next) != nil || next == parent {
			break
		}
		parent = next
	}
	return &Operation{Action: "focus", App: s.app, Target: &target, ObservedAt: event.at}
}

func (s *linuxSemantics) focusedTarget(ctx context.Context) (*Target, string) {
	if s.ref.Bus == "" {
		return &Target{Role: "unknown"}, "X11 应用"
	}
	query, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	var states []uint32
	if s.bus.Object(s.ref.Bus, s.ref.Path).CallWithContext(query, atspiInterface+".GetState", 0).Store(&states) != nil || !linuxState(states, 12) {
		return &Target{Role: "unknown"}, "X11 应用"
	}
	target := s.target
	return &target, s.app
}

// Seed an already focused control without reading any text interface. The walk
// is bounded by time, depth, node count, and children; unexposed apps stay unknown.
func (s *linuxSemantics) initialFocus(ctx context.Context) *Operation {
	query, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	type candidate struct {
		ref   linuxAccessibleRef
		depth int
	}
	stack := []candidate{{linuxAccessibleRef{atspiRegistry, "/org/a11y/atspi/accessible/root"}, 0}}
	for visited := 0; len(stack) > 0 && visited < 256 && query.Err() == nil; visited++ {
		current := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		object := s.bus.Object(current.ref.Bus, current.ref.Path)
		var states []uint32
		if object.CallWithContext(query, atspiInterface+".GetState", 0).Store(&states) == nil && linuxState(states, 12) {
			return s.focus(ctx, linuxFocus{current.ref, true, time.Now()})
		}
		if current.depth >= 12 {
			continue
		}
		var count dbus.Variant
		if object.CallWithContext(query, "org.freedesktop.DBus.Properties.Get", 0, atspiInterface, "ChildCount").Store(&count) != nil {
			continue
		}
		children, ok := count.Value().(int32)
		if !ok || children < 0 {
			continue
		}
		if children > 32 {
			children = 32
		}
		for index := children - 1; index >= 0 && query.Err() == nil; index-- {
			var child linuxAccessibleRef
			if object.CallWithContext(query, atspiInterface+".GetChildAtIndex", 0, index).Store(&child) == nil && child.Bus != "" && child.Path.IsValid() && child.Path != "/org/a11y/atspi/null" {
				stack = append(stack, candidate{child, current.depth + 1})
			}
		}
	}
	return nil
}

func (s *linuxSemantics) hitTest(ctx context.Context, x, y int16) (*Target, string, linuxAccessibleRef) {
	if s.frame.Bus == "" {
		return &Target{Role: "unknown"}, "X11 应用", linuxAccessibleRef{}
	}
	query, cancel := context.WithTimeout(ctx, 150*time.Millisecond)
	defer cancel()
	ref := s.frame
	for depth := 0; depth < 8; depth++ {
		var next linuxAccessibleRef
		if s.bus.Object(ref.Bus, ref.Path).CallWithContext(query, "org.a11y.atspi.Component.GetAccessibleAtPoint", 0, int32(x), int32(y), uint32(0)).Store(&next) != nil || next.Bus == "" || next.Path == "/org/a11y/atspi/null" {
			break
		}
		if next == ref {
			break
		}
		ref = next
	}
	if ref == s.frame {
		return &Target{Role: "unknown"}, "X11 应用", linuxAccessibleRef{}
	}
	target, _, err := s.inspect(query, ref)
	if err != nil {
		return &Target{Role: "unknown"}, "X11 应用", linuxAccessibleRef{}
	}
	return &target, s.app, ref
}

type linuxKeyMap struct {
	symbols   map[byte]uint32
	modifiers map[byte]bool
}

func linuxModifier(symbol uint32) string {
	switch symbol {
	case 0xfe03, 0xfe11, 0xff7e:
		return "ALTGR"
	case 0xffe1, 0xffe2:
		return "SHIFT"
	case 0xffe3, 0xffe4:
		return "CTRL"
	case 0xffe7, 0xffe8, 0xffeb, 0xffec:
		return "SUPER"
	case 0xffe9, 0xffea:
		return "ALT"
	}
	return ""
}

func (k *linuxKeyMap) operation(detail byte, pressed bool, target *Target) (string, string) {
	symbol := k.symbols[detail]
	if linuxModifier(symbol) != "" {
		k.modifiers[detail] = pressed
		return "", ""
	}
	if !pressed {
		return "", ""
	}
	mods := make(map[string]bool)
	for code, down := range k.modifiers {
		if down {
			mods[linuxModifier(k.symbols[code])] = true
		}
	}
	keys := map[uint32]string{0xff08: "BACKSPACE", 0xff09: "TAB", 0xff0d: "ENTER", 0xff1b: "ESCAPE", 0xffff: "DELETE", 0xff50: "HOME", 0xff57: "END", 0xff51: "LEFT", 0xff52: "UP", 0xff53: "RIGHT", 0xff54: "DOWN", 0xff55: "PAGEUP", 0xff56: "PAGEDOWN", 0xff63: "INSERT"}
	key := keys[symbol]
	if symbol >= 0xffbe && symbol <= 0xffd5 {
		key = fmt.Sprintf("F%d", symbol-0xffbe+1)
	}
	// AltGr often arrives as Ctrl+Alt. A printable key in an input field must
	// remain an input fact; serializing the corresponding letter leaks content.
	if key == "" && (mods["ALTGR"] || (mods["CTRL"] && mods["ALT"])) {
		if target != nil && (target.Writable || target.Secret) {
			return "input", ""
		}
		return "", ""
	}
	if target != nil && (target.Writable || target.Secret) && ((mods["CTRL"] && !mods["ALT"] && !mods["ALTGR"] && symbol == 'v') || (mods["SHIFT"] && symbol == 0xff63)) {
		return "input", "PASTE"
	}
	if key == "" && (mods["CTRL"] || mods["ALT"] || mods["SUPER"]) && ((symbol >= 'a' && symbol <= 'z') || (symbol >= '0' && symbol <= '9')) {
		key = strings.ToUpper(string(rune(symbol)))
	}
	if key != "" {
		prefix := []string{}
		for _, name := range []string{"CTRL", "ALT", "SUPER", "SHIFT"} {
			if mods[name] {
				prefix = append(prefix, name)
			}
		}
		return "key", strings.Join(append(prefix, key), "+")
	}
	// Printable keys are never translated or stored. The fact of input is enough.
	if target != nil && (target.Writable || target.Secret) && !mods["CTRL"] && !mods["ALT"] && !mods["SUPER"] {
		return "input", ""
	}
	return "", ""
}

func linuxKeyboard(x *linuxXConnection) (linuxKeyMap, error) {
	setup := xproto.Setup(x.conn)
	first, last := byte(setup.MinKeycode), byte(setup.MaxKeycode)
	if last < first {
		return linuxKeyMap{}, errors.New("X11 键盘映射无效")
	}
	mapping, err := xproto.GetKeyboardMapping(x.conn, xproto.Keycode(first), last-first+1).Reply()
	if err != nil || mapping == nil || mapping.KeysymsPerKeycode == 0 {
		return linuxKeyMap{}, errors.New("无法读取 X11 键盘布局")
	}
	keys := linuxKeyMap{symbols: make(map[byte]uint32), modifiers: make(map[byte]bool)}
	for code := int(first); code <= int(last); code++ {
		index := (code - int(first)) * int(mapping.KeysymsPerKeycode)
		if index < len(mapping.Keysyms) {
			keys.symbols[byte(code)] = uint32(mapping.Keysyms[index])
		}
	}
	pressed, err := xproto.QueryKeymap(x.conn).Reply()
	if err == nil && pressed != nil {
		for code, symbol := range keys.symbols {
			if linuxModifier(symbol) != "" && pressed.Keys[code/8]&(1<<(code%8)) != 0 {
				keys.modifiers[code] = true
			}
		}
	}
	return keys, nil
}

type linuxClickIdentity struct {
	at     uint32
	button byte
}
type linuxPendingClick struct {
	id       linuxClickIdentity
	observed time.Time
	due      time.Time
	order    uint64
}

func linuxPendingReady(pending map[linuxClickIdentity]linuxPendingClick, now time.Time, all bool) []linuxPendingClick {
	result := make([]linuxPendingClick, 0, len(pending))
	for _, event := range pending {
		if all || !now.Before(event.due) {
			result = append(result, event)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].order < result[j].order })
	return result
}

func linuxPointerAction(button byte) (string, string) {
	switch button {
	case 1:
		return "click", ""
	case 2:
		return "click", "MIDDLE_CLICK"
	case 3:
		return "click", "RIGHT_CLICK"
	case 4:
		return "scroll", "UP"
	case 5:
		return "scroll", "DOWN"
	case 6:
		return "scroll", "LEFT"
	case 7:
		return "scroll", "RIGHT"
	default:
		return "", ""
	}
}

type linuxDoubleSettings struct {
	milliseconds  uint32
	distance      int32
	serial, owner uint32
}

// XSETTINGS 0.5 stores all settings in an endian-tagged, padded property. Only
// two known integer settings are retained; all string/color values are skipped.
func linuxParseDoubleSettings(data []byte) (linuxDoubleSettings, bool) {
	if len(data) < 12 || len(data) > 65536 || data[0] > 1 {
		return linuxDoubleSettings{}, false
	}
	order := binary.ByteOrder(binary.LittleEndian)
	if data[0] == 1 {
		order = binary.BigEndian
	}
	count := order.Uint32(data[8:12])
	if count > 256 {
		return linuxDoubleSettings{}, false
	}
	settings := linuxDoubleSettings{serial: order.Uint32(data[4:8])}
	foundTime, foundDistance := false, false
	offset := 12
	for index := uint32(0); index < count; index++ {
		if offset+4 > len(data) {
			return linuxDoubleSettings{}, false
		}
		kind := data[offset]
		size := int(order.Uint16(data[offset+2 : offset+4]))
		offset += 4
		padded := (size + 3) &^ 3
		if size > 256 || offset+padded+4 > len(data) {
			return linuxDoubleSettings{}, false
		}
		name := string(data[offset : offset+size])
		offset += padded + 4 // last-change serial
		switch kind {
		case 0:
			if offset+4 > len(data) {
				return linuxDoubleSettings{}, false
			}
			value := int32(order.Uint32(data[offset : offset+4]))
			offset += 4
			if name == "Net/DoubleClickTime" {
				if foundTime || value <= 0 || value > 10000 {
					return linuxDoubleSettings{}, false
				}
				settings.milliseconds = uint32(value)
				foundTime = true
			} else if name == "Net/DoubleClickDistance" {
				if foundDistance || value < 0 || value > 1000 {
					return linuxDoubleSettings{}, false
				}
				settings.distance = value
				foundDistance = true
			}
		case 1:
			if offset+4 > len(data) {
				return linuxDoubleSettings{}, false
			}
			size := order.Uint32(data[offset : offset+4])
			offset += 4
			if size > 65536 || uint64(offset)+uint64((size+3)&^3) > uint64(len(data)) {
				return linuxDoubleSettings{}, false
			}
			offset += int((size + 3) &^ 3)
		case 2:
			if offset+8 > len(data) {
				return linuxDoubleSettings{}, false
			}
			offset += 8
		default:
			return linuxDoubleSettings{}, false
		}
	}
	return settings, foundTime && foundDistance
}

func linuxCurrentDoubleSettings(x *linuxXConnection) (linuxDoubleSettings, bool) {
	x.wire.SetDeadline(time.Now().Add(300 * time.Millisecond))
	defer x.wire.SetDeadline(time.Time{})
	selectionName := fmt.Sprintf("_XSETTINGS_S%d", x.conn.DefaultScreen)
	selection, err := xproto.InternAtom(x.conn, true, uint16(len(selectionName)), selectionName).Reply()
	if err != nil || selection == nil || selection.Atom == 0 {
		return linuxDoubleSettings{}, false
	}
	propertyName := "_XSETTINGS_SETTINGS"
	property, err := xproto.InternAtom(x.conn, true, uint16(len(propertyName)), propertyName).Reply()
	if err != nil || property == nil || property.Atom == 0 {
		return linuxDoubleSettings{}, false
	}
	owner, err := xproto.GetSelectionOwner(x.conn, selection.Atom).Reply()
	if err != nil || owner == nil || owner.Owner == 0 {
		return linuxDoubleSettings{}, false
	}
	value, err := xproto.GetProperty(x.conn, false, owner.Owner, property.Atom, property.Atom, 0, 65536/4).Reply()
	if err != nil || value == nil || value.Format != 8 || value.BytesAfter != 0 {
		return linuxDoubleSettings{}, false
	}
	settings, valid := linuxParseDoubleSettings(value.Value)
	settings.owner = uint32(owner.Owner)
	return settings, valid
}

type linuxClickSnapshot struct {
	operation          Operation
	epoch              uint64
	button             byte
	ref                linuxAccessibleRef
	window, serverTime uint32
	x, y               int16
	settings           linuxDoubleSettings
	validSettings      bool
}
type linuxClickMerger struct {
	waiting *linuxClickSnapshot
	focus   []Operation
}

func (m *linuxClickMerger) flush() []Operation {
	if m.waiting == nil {
		return nil
	}
	result := append([]Operation{m.waiting.operation}, m.focus...)
	m.waiting, m.focus = nil, nil
	return result
}
func (m *linuxClickMerger) expires(now time.Time) []Operation {
	if m.waiting != nil && now.Sub(m.waiting.operation.ObservedAt) >= time.Duration(m.waiting.settings.milliseconds)*time.Millisecond {
		return m.flush()
	}
	return nil
}
func (m *linuxClickMerger) add(next linuxClickSnapshot) []Operation {
	if next.epoch == 0 {
		// A paused click terminates the pending pair without consuming a
		// later click from the next recording interval.
		return m.flush()
	}
	canWait := next.button == 1 && next.validSettings && next.ref.Bus != "" && next.window != 0 && next.operation.Target != nil && next.operation.Target.Role != "unknown"
	if m.waiting != nil && canWait {
		prior := m.waiting
		dx, dy := int32(next.x)-int32(prior.x), int32(next.y)-int32(prior.y)
		if dx < 0 {
			dx = -dx
		}
		if dy < 0 {
			dy = -dy
		}
		if next.epoch == prior.epoch && next.ref == prior.ref && next.window == prior.window && next.settings == prior.settings &&
			uint32(next.serverTime-prior.serverTime) <= prior.settings.milliseconds && dx <= prior.settings.distance && dy <= prior.settings.distance {
			operation := prior.operation
			operation.Key = "DOUBLE_CLICK"
			result := append([]Operation{operation}, m.focus...)
			m.waiting, m.focus = nil, nil
			return result
		}
	}
	result := m.flush()
	if canWait {
		m.waiting = &next
	} else {
		result = append(result, next.operation)
	}
	return result
}

func capture(ctx context.Context, emit func(Operation), onReady func(), epochAt func(time.Time) uint64) error {
	ctx, cancelCapture := context.WithCancel(ctx)
	defer cancelCapture()
	if _, err := linuxSessionType(os.Getenv("XDG_SESSION_TYPE"), os.Getenv("WAYLAND_DISPLAY"), os.Getenv("DISPLAY")); err != nil {
		return err
	}
	control, err := openLinuxX11(ctx)
	if err != nil {
		return err
	}
	defer control.close()
	if err = linuxRecordAvailable(control); err != nil {
		return err
	}
	keys, err := linuxKeyboard(control)
	if err != nil {
		return err
	}
	handler := &linuxSignalHandler{ctx: ctx, events: make(chan linuxFocus, 64), failures: make(chan error, 1)}
	bus, err := openLinuxAccessibility(ctx, handler)
	if err != nil {
		return errors.New("AT-SPI 辅助功能不可用，请启用桌面辅助功能后重试")
	}
	defer bus.Close()
	query, cancel := context.WithTimeout(ctx, 2*time.Second)
	err = bus.AddMatchSignalContext(query, dbus.WithMatchInterface("org.a11y.atspi.Event.Object"), dbus.WithMatchMember("StateChanged"), dbus.WithMatchArg(0, "focused"))
	if err == nil {
		err = bus.Object(atspiRegistry, "/org/a11y/atspi/registry").CallWithContext(query, atspiRegistry+".RegisterEvent", 0, atspiFocusEvent, []string{}, "").Err
	}
	cancel()
	if err != nil {
		return errors.New("无法注册 AT-SPI 焦点事件，请检查当前桌面的辅助功能服务")
	}
	defer func() {
		query, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		bus.Object(atspiRegistry, "/org/a11y/atspi/registry").CallWithContext(query, atspiRegistry+".DeregisterEvent", 0, atspiFocusEvent, "")
	}()
	contextID, err := record.NewContextId(control.conn)
	if err != nil {
		return errors.New("无法创建 X11 录制上下文")
	}
	ranges := []record.Range{{DeviceEvents: record.Range8{First: 2, Last: 5}, DeliveredEvents: record.Range8{First: 4, Last: 4}}}
	control.wire.SetDeadline(time.Now().Add(2 * time.Second))
	if err = record.CreateContextChecked(control.conn, contextID, 0, 1, 1, []record.ClientSpec{record.CsAllClients}, ranges).Check(); err != nil {
		return errors.New("X11 服务拒绝被动录制上下文")
	}
	defer record.FreeContext(control.conn, contextID)
	data, err := openLinuxX11(ctx)
	if err != nil {
		return err
	}
	defer data.close()
	if err = record.Init(data.conn); err != nil {
		return errors.New("无法打开 X11 RECORD 事件流")
	}
	data.wire.mu.Lock()
	data.wire.opcode = data.conn.Extensions["RECORD"]
	data.wire.mu.Unlock()
	initial, err := record.EnableContext(data.conn, contextID).Reply()
	if err != nil || initial == nil || initial.Category != 4 {
		return errors.New("X11 RECORD 没有返回有效的录制启动确认")
	}
	control.wire.SetDeadline(time.Time{})
	data.wire.SetDeadline(time.Time{})
	go func() { <-ctx.Done(); data.wire.Close(); control.wire.Close() }()
	semantics := linuxSemantics{bus: bus, target: Target{Role: "unknown"}}
	initialFocus := semantics.initialFocus(ctx)
	onReady()
	if initialFocus != nil {
		emit(*initialFocus)
	}
	pending := make(map[linuxClickIdentity]linuxPendingClick)
	var pendingOrder uint64
	seen := make(map[linuxClickIdentity]time.Time)
	merger := linuxClickMerger{}
	emitMany := func(operations []Operation) {
		for _, operation := range operations {
			emit(operation)
		}
	}
	tick := time.NewTicker(20 * time.Millisecond)
	defer tick.Stop()
	click := func(snapshot linuxClickSnapshot) {
		snapshot.epoch = epochAt(snapshot.operation.ObservedAt)
		if snapshot.epoch == 0 {
			emitMany(merger.add(snapshot))
			return
		}
		action, key := linuxPointerAction(snapshot.button)
		if action == "" {
			emitMany(merger.flush())
			return
		}
		snapshot.operation.Action, snapshot.operation.Key = action, key
		if snapshot.button == 1 && snapshot.ref.Bus != "" {
			snapshot.settings, snapshot.validSettings = linuxCurrentDoubleSettings(control)
			for code, down := range keys.modifiers {
				if down && linuxModifier(keys.symbols[code]) != "" {
					snapshot.validSettings = false
				}
			}
		}
		emitMany(merger.add(snapshot))
	}
	flushPending := func(now time.Time, all bool) {
		for _, event := range linuxPendingReady(pending, now, all) {
			click(linuxClickSnapshot{button: event.id.button, serverTime: event.id.at, operation: Operation{App: "X11 应用", Target: &Target{Role: "unknown"}, ObservedAt: event.observed}})
			seen[event.id] = now
			delete(pending, event.id)
		}
	}
	defer func() {
		// Device-only clicks still represent observed actions. Preserve their
		// order and the final click when stop arrives inside the correlate window.
		flushPending(time.Now(), true)
		emitMany(merger.flush())
	}()
	for {
		select {
		case <-ctx.Done():
			return nil
		case err := <-data.wire.failures:
			if ctx.Err() != nil {
				return nil
			}
			return err
		case err := <-handler.failures:
			return err
		case focus := <-handler.events:
			if operation := semantics.focus(ctx, focus); operation != nil {
				if merger.waiting != nil {
					if len(merger.focus) >= 64 {
						emitMany(merger.flush())
						emit(*operation)
					} else {
						merger.focus = append(merger.focus, *operation)
					}
				} else {
					emit(*operation)
				}
			}
		case now := <-tick.C:
			emitMany(merger.expires(now))
			flushPending(now, false)
			for id, at := range seen {
				if now.Sub(at) > time.Second {
					delete(seen, id)
				}
			}
		case packet := <-data.wire.packets:
			if packet.bytes[1] == 5 {
				return errors.New("X11 RECORD 事件流意外结束")
			}
			if packet.bytes[1] != 0 || packet.bytes[8] != 0 || (len(packet.bytes)-32)%32 != 0 {
				if packet.bytes[1] == 0 {
					return errors.New("X11 RECORD 返回了无法解析的事件格式")
				}
				continue
			}
			device := binary.LittleEndian.Uint32(packet.bytes[12:16]) == 0
			order := binary.ByteOrder(binary.LittleEndian)
			if packet.bytes[9] != 0 {
				order = binary.BigEndian
			}
			for offset := 32; offset+32 <= len(packet.bytes); offset += 32 {
				event := packet.bytes[offset : offset+32]
				kind, detail := event[0]&127, event[1]
				if event[0]&128 != 0 {
					continue
				} // Ignore synthetic SendEvent requests.
				if device && (kind == 2 || kind == 3) {
					flushPending(time.Now(), true)
					emitMany(merger.flush())
					target, app := semantics.focusedTarget(ctx)
					action, key := keys.operation(detail, kind == 2, target)
					if action != "" {
						emit(Operation{Action: action, App: app, Target: target, Key: key, ObservedAt: packet.at})
					}
				} else if kind == 4 {
					id := linuxClickIdentity{order.Uint32(event[4:8]), detail}
					if _, duplicate := seen[id]; duplicate {
						continue
					}
					if device {
						if _, exists := pending[id]; !exists {
							pendingOrder++
							pending[id] = linuxPendingClick{id, packet.at, time.Now().Add(60 * time.Millisecond), pendingOrder}
						}
						continue
					}
					// Only delivered core events have guaranteed screen coordinates.
					target, app, ref := &Target{Role: "unknown"}, "X11 应用", linuxAccessibleRef{}
					var screenX, screenY int16
					if event[30] != 0 {
						screenX, screenY = int16(order.Uint16(event[20:22])), int16(order.Uint16(event[22:24]))
						target, app, ref = semantics.hitTest(ctx, screenX, screenY)
					}
					observed := packet.at
					if prior, ok := pending[id]; ok {
						observed = prior.observed
					}
					click(linuxClickSnapshot{button: detail, ref: ref, window: order.Uint32(event[12:16]), serverTime: id.at, x: screenX, y: screenY, operation: Operation{App: app, Target: target, ObservedAt: observed}})
					delete(pending, id)
					seen[id] = time.Now()
				}
			}
		}
	}
}
