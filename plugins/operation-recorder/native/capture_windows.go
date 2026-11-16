//go:build windows && (amd64 || arm64)

package main

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	winUser                  = windows.NewLazySystemDLL("user32.dll")
	winOle                   = windows.NewLazySystemDLL("ole32.dll")
	winAutomation            = windows.NewLazySystemDLL("oleaut32.dll")
	winKernel                = windows.NewLazySystemDLL("kernel32.dll")
	setWindowsHook           = winUser.NewProc("SetWindowsHookExW")
	unhookWindowsHook        = winUser.NewProc("UnhookWindowsHookEx")
	callNextHook             = winUser.NewProc("CallNextHookEx")
	getMessage               = winUser.NewProc("GetMessageW")
	peekMessage              = winUser.NewProc("PeekMessageW")
	postThreadMessage        = winUser.NewProc("PostThreadMessageW")
	getForegroundWindow      = winUser.NewProc("GetForegroundWindow")
	getWindowProcess         = winUser.NewProc("GetWindowThreadProcessId")
	getAsyncKeyState         = winUser.NewProc("GetAsyncKeyState")
	getDoubleClickTime       = winUser.NewProc("GetDoubleClickTime")
	getSystemMetrics         = winUser.NewProc("GetSystemMetrics")
	openInputDesktop         = winUser.NewProc("OpenInputDesktop")
	closeDesktop             = winUser.NewProc("CloseDesktop")
	getThreadDesktop         = winUser.NewProc("GetThreadDesktop")
	getProcessWindowStation  = winUser.NewProc("GetProcessWindowStation")
	getUserObjectInformation = winUser.NewProc("GetUserObjectInformationW")
	getModuleHandle          = winKernel.NewProc("GetModuleHandleW")
	coInitialize             = winOle.NewProc("CoInitializeEx")
	coUninitialize           = winOle.NewProc("CoUninitialize")
	coCreateInstance         = winOle.NewProc("CoCreateInstance")
	sysStringLen             = winAutomation.NewProc("SysStringLen")
	sysFreeString            = winAutomation.NewProc("SysFreeString")
	activeWindowsHooks       atomic.Pointer[windowsHookSession]
	keyboardHookCallback     = windows.NewCallback(windowsKeyboardHook)
	mouseHookCallback        = windows.NewCallback(windowsMouseHook)
	errWindowsQueueOverflow  = errors.New("Windows recording could not keep up with input. Recording stopped; review the captured steps and retry more slowly.")
)

const windowsPermissionHelp = "Use an unlocked interactive Windows desktop. Run the target application and iPolloWork at the same integrity level; elevated or protected applications cannot be recorded from a lower-integrity process. No elevation is requested automatically."

type windowsPoint struct{ X, Y int32 }
type windowsMessage struct {
	Window         uintptr
	Message        uint32
	WParam, LParam uintptr
	Time           uint32
	Point          windowsPoint
	Private        uint32
}
type windowsKeyboardData struct {
	VirtualKey, ScanCode, Flags, Time uint32
	ExtraInfo                         uintptr
}
type windowsMouseData struct {
	Point                  windowsPoint
	MouseData, Flags, Time uint32
	ExtraInfo              uintptr
}
type windowsEvent struct {
	Action, Key string
	Window      uintptr
	Point       windowsPoint // Transient hit-test evidence; never included in Operation.
	ObservedAt  time.Time
}
type windowsHookSession struct {
	Capture bool // Permission probes reserve the owner without observing input.
	Events  chan windowsEvent
	Failure chan error
	Pressed [256]bool // Virtual-key state only; never decoded into characters.
}

type windowsWorker struct {
	done chan struct{}
	err  error // Written before done closes; only read after that synchronization.
}

func (worker *windowsWorker) wait(timeout time.Duration) error {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-worker.done:
		if errors.Is(worker.err, context.Canceled) {
			return nil
		}
		return worker.err
	case <-timer.C:
		return errors.New("Windows UI Automation did not finish before the shutdown deadline; review the last captured step")
	}
}

// These layouts follow Microsoft's generated UIAutomationClient.h. The named
// fields are the only callable slots; skipped methods can never be invoked.
// https://raw.githubusercontent.com/microsoft/win32metadata/main/generation/WinSDK/RecompiledIdlHeaders/um/UIAutomationClient.h
type windowsUnknownVTable struct{ QueryInterface, AddRef, Release uintptr }
type windowsAutomationVTable struct {
	windowsUnknownVTable
	CompareElements, CompareRuntimeIDs, GetRootElement                 uintptr
	ElementFromHandle, ElementFromPoint, GetFocusedElement             uintptr
	Skipped                                                            [52]uintptr // IUIAutomation2 slots 9 through 60.
	PutConnectionTimeout, GetTransactionTimeout, PutTransactionTimeout uintptr
}
type windowsElementVTable struct {
	windowsUnknownVTable
	SkippedBeforeProcess                                                           [17]uintptr // Slots 3 through 19.
	CurrentProcessID, CurrentControlType, CurrentLocalizedControlType, CurrentName uintptr
	SkippedBeforePassword                                                          [11]uintptr // Slots 24 through 34.
	CurrentIsPassword                                                              uintptr
}
type windowsAutomation struct{ Table *windowsAutomationVTable }
type windowsElement struct{ Table *windowsElementVTable }

func windowsHRESULT(result uintptr, operation string) error {
	if int32(result) < 0 {
		return fmt.Errorf("Windows UI Automation %s failed (HRESULT 0x%08X). %s", operation, uint32(result), windowsPermissionHelp)
	}
	return nil
}

func newWindowsAutomation() (*windowsAutomation, error) {
	result, _, _ := coInitialize.Call(0, 0) // COINIT_MULTITHREADED, on one locked non-UI thread.
	if err := windowsHRESULT(result, "initialization"); err != nil {
		return nil, err
	}
	clsid := windows.GUID{Data1: 0xe22ad333, Data2: 0xb25f, Data3: 0x460c, Data4: [8]byte{0x83, 0xd0, 0x05, 0x81, 0x10, 0x73, 0x95, 0xc9}}
	iid := windows.GUID{Data1: 0x34723aff, Data2: 0x0c9d, Data3: 0x49d0, Data4: [8]byte{0x98, 0x96, 0x7a, 0xb5, 0x2d, 0xf8, 0xcd, 0x8a}}
	var client *windowsAutomation
	result, _, _ = coCreateInstance.Call(uintptr(unsafe.Pointer(&clsid)), 0, 1, uintptr(unsafe.Pointer(&iid)), uintptr(unsafe.Pointer(&client)))
	if err := windowsHRESULT(result, "creation"); err != nil {
		coUninitialize.Call()
		return nil, err
	}
	if client == nil {
		coUninitialize.Call()
		return nil, errors.New("Windows UI Automation returned no client")
	}
	// IUIAutomation2 bounds provider latency; the hook thread never calls COM.
	for _, setter := range []uintptr{client.Table.PutConnectionTimeout, client.Table.PutTransactionTimeout} {
		result, _, _ = syscall.SyscallN(setter, uintptr(unsafe.Pointer(client)), 500)
		if err := windowsHRESULT(result, "timeout setup"); err != nil {
			client.close()
			return nil, err
		}
	}
	return client, nil
}

func (client *windowsAutomation) close() {
	syscall.SyscallN(client.Table.Release, uintptr(unsafe.Pointer(client)))
	coUninitialize.Call()
}

func (client *windowsAutomation) target(event windowsEvent, expectedPID uint32) (*Target, error) {
	var element *windowsElement
	var result uintptr
	if event.Action == "click" {
		// POINT is an 8-byte by-value argument on both Windows amd64 and arm64.
		point := uintptr(uint64(uint32(event.Point.X)) | uint64(uint32(event.Point.Y))<<32)
		result, _, _ = syscall.SyscallN(client.Table.ElementFromPoint, uintptr(unsafe.Pointer(client)), point, uintptr(unsafe.Pointer(&element)))
	} else {
		result, _, _ = syscall.SyscallN(client.Table.GetFocusedElement, uintptr(unsafe.Pointer(client)), uintptr(unsafe.Pointer(&element)))
	}
	if err := windowsHRESULT(result, "target lookup"); err != nil {
		return nil, err
	}
	if element == nil {
		return &Target{Role: "unknown"}, nil
	}
	defer syscall.SyscallN(element.Table.Release, uintptr(unsafe.Pointer(element)))
	var pid, controlType, password int32
	for _, property := range []struct {
		Method uintptr
		Output *int32
	}{
		{element.Table.CurrentProcessID, &pid}, {element.Table.CurrentControlType, &controlType}, {element.Table.CurrentIsPassword, &password},
	} {
		result, _, _ = syscall.SyscallN(property.Method, uintptr(unsafe.Pointer(element)), uintptr(unsafe.Pointer(property.Output)))
		if err := windowsHRESULT(result, "target metadata"); err != nil {
			return nil, err
		}
	}
	if uint32(pid) != expectedPID {
		return &Target{Role: "unknown"}, nil
	}
	target := &Target{Role: windowsControlRole(controlType), Secret: password != 0, Writable: controlType == 50003 || controlType == 50004 || controlType == 50030 || password != 0}
	if target.Secret {
		target.Name = "Protected input"
		return target, nil
	}
	// Custom providers sometimes expose the entered value as Name. Never read
	// Name for writable controls, even when IsPassword is false.
	if target.Writable {
		target.Name = "Writable input"
		return target, nil
	}
	if !windowsNamedControl(controlType) {
		return target, nil
	}
	var name *uint16
	result, _, _ = syscall.SyscallN(element.Table.CurrentName, uintptr(unsafe.Pointer(element)), uintptr(unsafe.Pointer(&name)))
	if err := windowsHRESULT(result, "accessible label"); err != nil {
		return nil, err
	}
	if name != nil {
		defer sysFreeString.Call(uintptr(unsafe.Pointer(name)))
		length, _, _ := sysStringLen.Call(uintptr(unsafe.Pointer(name)))
		if length > 160 {
			length = 160
		}
		// BSTR length is supplied by OleAut32; this is the sole string ABI boundary.
		target.Name = strings.TrimSpace(strings.ReplaceAll(windows.UTF16ToString(unsafe.Slice(name, int(length))), "\n", " "))
	}
	label := strings.ToLower(target.Name)
	for _, secretLabel := range []string{"password", "passwd", "passcode", "token", "secret", "api key", "密码", "密钥", "验证码"} {
		if strings.Contains(label, secretLabel) {
			target.Secret = true
			target.Name = "Protected input"
			break
		}
	}
	return target, nil
}

func windowsControlRole(control int32) string {
	roles := map[int32]string{50000: "Button", 50002: "CheckBox", 50003: "ComboBox", 50004: "TextField", 50005: "Hyperlink", 50007: "ListItem", 50008: "List", 50009: "Menu", 50010: "MenuBar", 50011: "MenuItem", 50012: "ProgressBar", 50013: "RadioButton", 50014: "ScrollBar", 50015: "Slider", 50016: "Spinner", 50018: "Tab", 50019: "TabItem", 50020: "Text", 50021: "ToolBar", 50023: "Tree", 50024: "TreeItem", 50025: "Custom", 50028: "DataGrid", 50029: "DataItem", 50030: "Document", 50031: "SplitButton", 50032: "Window", 50033: "Pane", 50036: "Table"}
	if role, found := roles[control]; found {
		return role
	}
	return "unknown"
}

func windowsNamedControl(control int32) bool {
	switch control {
	case 50000, 50002, 50005, 50011, 50013, 50019, 50031:
		return true // Button, CheckBox, Hyperlink, MenuItem, RadioButton, TabItem, SplitButton.
	default:
		return false
	}
}

func windowsObjectName(handle uintptr) (string, error) {
	var name [128]uint16
	var needed uint32
	result, _, err := getUserObjectInformation.Call(handle, 2, uintptr(unsafe.Pointer(&name[0])), uintptr(unsafe.Sizeof(name)), uintptr(unsafe.Pointer(&needed)))
	if result == 0 {
		return "", fmt.Errorf("Windows desktop metadata is inaccessible: %w", err)
	}
	return windows.UTF16ToString(name[:]), nil
}

func windowsDesktopState() error {
	station, _, _ := getProcessWindowStation.Call()
	name, err := windowsObjectName(station)
	if err != nil || !strings.EqualFold(name, "WinSta0") {
		return errors.New("Windows recording requires an interactive user session; service/session-0 desktops are unsupported")
	}
	desktop, _, _ := openInputDesktop.Call(0, 0, 1) // DESKTOP_READOBJECTS; never switches desktops.
	if desktop == 0 {
		return errors.New("Windows input desktop is locked, protected, or inaccessible. Unlock the session before recording.")
	}
	defer closeDesktop.Call(desktop)
	inputName, err := windowsObjectName(desktop)
	if err != nil {
		return err
	}
	threadDesktop, _, _ := getThreadDesktop.Call(uintptr(windows.GetCurrentThreadId()))
	threadName, err := windowsObjectName(threadDesktop)
	if err != nil {
		return err
	}
	if !strings.EqualFold(inputName, threadName) || strings.EqualFold(inputName, "Winlogon") {
		return errors.New("Windows switched to a lock screen or protected desktop; recording stopped")
	}
	return nil
}

func windowsIntegrity(process windows.Handle) (uint32, error) {
	var token windows.Token
	if err := windows.OpenProcessToken(process, windows.TOKEN_QUERY, &token); err != nil {
		return 0, err
	}
	defer token.Close()
	var length uint32
	err := windows.GetTokenInformation(token, windows.TokenIntegrityLevel, nil, 0, &length)
	if err != windows.ERROR_INSUFFICIENT_BUFFER || length < uint32(unsafe.Sizeof(windows.SIDAndAttributes{})) || length > 4096 {
		return 0, errors.New("Windows process integrity level is inaccessible")
	}
	buffer := make([]byte, length)
	if err := windows.GetTokenInformation(token, windows.TokenIntegrityLevel, &buffer[0], length, &length); err != nil {
		return 0, err
	}
	// TOKEN_MANDATORY_LABEL begins with SID_AND_ATTRIBUTES, as defined by WinNT.h.
	label := (*windows.SIDAndAttributes)(unsafe.Pointer(&buffer[0]))
	if label.Sid == nil || !label.Sid.IsValid() || label.Sid.SubAuthorityCount() == 0 {
		return 0, errors.New("Windows returned an invalid integrity label")
	}
	level := label.Sid.SubAuthority(uint32(label.Sid.SubAuthorityCount() - 1))
	runtime.KeepAlive(buffer)
	return level, nil
}

func windowsApplication(window uintptr, ownIntegrity uint32) (Operation, uint32, error) {
	var pid uint32
	getWindowProcess.Call(window, uintptr(unsafe.Pointer(&pid)))
	if pid == 0 {
		return Operation{}, 0, errors.New("The recorded Windows application closed before its target could be resolved")
	}
	process, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return Operation{}, 0, fmt.Errorf("The recorded Windows application is inaccessible. %s", windowsPermissionHelp)
	}
	defer windows.CloseHandle(process)
	integrity, err := windowsIntegrity(process)
	if err != nil || integrity > ownIntegrity {
		return Operation{}, 0, fmt.Errorf("The recorded Windows application has a protected or higher-integrity process. %s", windowsPermissionHelp)
	}
	var path [1024]uint16
	length := uint32(len(path))
	if err := windows.QueryFullProcessImageName(process, 0, &path[0], &length); err != nil {
		return Operation{}, 0, errors.New("The recorded Windows application identity is inaccessible")
	}
	executable := filepath.Base(windows.UTF16ToString(path[:length]))
	return Operation{App: strings.TrimSuffix(executable, filepath.Ext(executable)), BundleID: "windows:" + strings.ToLower(executable), Window: "Window"}, pid, nil
}

func platformCapabilities() Capabilities {
	capability := Capabilities{Supported: true, Backend: "windows-uia-hooks", SessionType: "interactive-desktop", PermissionHelp: windowsPermissionHelp}
	if err := windowsDesktopState(); err != nil {
		capability.Reason = err.Error()
		return capability
	}
	ready := make(chan error, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		client, err := newWindowsAutomation()
		if err == nil {
			client.close()
		}
		ready <- err
	}()
	select {
	case err := <-ready:
		if err != nil {
			capability.Reason = err.Error()
			return capability
		}
	case <-time.After(4 * time.Second):
		capability.Reason = "Windows UI Automation initialization timed out"
		return capability
	}
	if err := windowsProbeHooks(); err != nil {
		capability.Reason = err.Error()
		return capability
	}
	capability.InputMonitoring = true
	level, err := windowsIntegrity(windows.CurrentProcess())
	if err != nil {
		capability.Reason = "The recorder's Windows process integrity is inaccessible"
		return capability
	}
	window, _, _ := getForegroundWindow.Call()
	if window != 0 {
		if _, _, err := windowsApplication(window, level); err != nil {
			capability.Reason = err.Error()
			return capability
		}
	}
	capability.Accessibility = true
	return capability
}

func windowsProbeHooks() (failure error) {
	// A probe cannot overlap a recorder or activate callback input inspection.
	probe := &windowsHookSession{}
	if !activeWindowsHooks.CompareAndSwap(nil, probe) {
		return errors.New("Windows input monitoring cannot be probed while this process is recording")
	}
	defer activeWindowsHooks.Store(nil)
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	module, _, _ := getModuleHandle.Call(0)
	keyboard, _, err := setWindowsHook.Call(13, keyboardHookCallback, module, 0)
	if keyboard == 0 {
		return fmt.Errorf("Windows keyboard monitoring is unavailable: %w. %s", err, windowsPermissionHelp)
	}
	defer func() {
		result, _, err := unhookWindowsHook.Call(keyboard)
		if result == 0 && failure == nil {
			failure = fmt.Errorf("Windows keyboard monitoring probe cleanup failed: %w", err)
		}
	}()
	mouse, _, err := setWindowsHook.Call(14, mouseHookCallback, module, 0)
	if mouse == 0 {
		return fmt.Errorf("Windows mouse monitoring is unavailable: %w. %s", err, windowsPermissionHelp)
	}
	defer func() {
		result, _, err := unhookWindowsHook.Call(mouse)
		if result == 0 && failure == nil {
			failure = fmt.Errorf("Windows mouse monitoring probe cleanup failed: %w", err)
		}
	}()
	return nil
}

func windowsPrintableKey(key uint32) bool {
	return key == 0x20 || key >= 0x30 && key <= 0x39 || key >= 0x41 && key <= 0x5A || key >= 0x60 && key <= 0x6F || key >= 0xBA && key <= 0xC0 || key >= 0xDB && key <= 0xDF || key == 0xE2
}

func windowsKeyName(key uint32, control, alt, shift, win, rightAlt bool) (action, name string) {
	if key == 0x10 || key == 0x11 || key == 0x12 || key == 0x5B || key == 0x5C || key >= 0xA0 && key <= 0xA5 {
		return "", ""
	}
	// AltGr is commonly represented as CTRL+ALT. Decide before queueing: UIA
	// may resolve a different focus later, so no printable shortcut identity is
	// retained for either AltGr form, even on currently non-writable controls.
	if windowsPrintableKey(key) && (rightAlt || control && alt) {
		return "input", ""
	}
	keys := map[uint32]string{0x08: "BACKSPACE", 0x09: "TAB", 0x0D: "ENTER", 0x13: "PAUSE", 0x1B: "ESCAPE", 0x20: "SPACE", 0x21: "PAGEUP", 0x22: "PAGEDOWN", 0x23: "END", 0x24: "HOME", 0x25: "ARROWLEFT", 0x26: "ARROWUP", 0x27: "ARROWRIGHT", 0x28: "ARROWDOWN", 0x2C: "PRINTSCREEN", 0x2D: "INSERT", 0x2E: "DELETE"}
	name = keys[key]
	if key >= 0x70 && key <= 0x87 {
		name = fmt.Sprintf("F%d", key-0x6F)
	}
	if name == "" && (control || alt || win) && (key >= 0x41 && key <= 0x5A || key >= 0x30 && key <= 0x39) {
		name = string(rune(key))
	} // Known virtual-key shortcut identities, not typed characters.
	if name == "" {
		if control || alt || win {
			return "", ""
		}
		return "input", ""
	}
	prefix := ""
	if control {
		prefix += "CTRL+"
	}
	if alt {
		prefix += "ALT+"
	}
	if shift {
		prefix += "SHIFT+"
	}
	if win {
		prefix += "WIN+"
	}
	if control && key == 0x56 && !alt && !win || shift && key == 0x2D && !control && !alt && !win {
		return "paste", prefix + name
	}
	return "key", prefix + name
}

func (session *windowsHookSession) keyEvent(key, flags uint32, down bool) windowsEvent {
	if key >= 256 {
		return windowsEvent{}
	}
	modifier := key
	if key == 0x11 {
		modifier = 0xA2
		if flags&1 != 0 {
			modifier = 0xA3
		}
	}
	if key == 0x12 {
		modifier = 0xA4
		if flags&1 != 0 {
			modifier = 0xA5
		}
	}
	if key == 0x10 || modifier == 0x5B || modifier == 0x5C || modifier >= 0xA0 && modifier <= 0xA5 {
		session.Pressed[modifier] = down
		if key == 0x10 && !down {
			session.Pressed[0xA0], session.Pressed[0xA1] = false, false
		}
		if (key == 0xA0 || key == 0xA1) && !down {
			session.Pressed[0x10] = false
		}
		return windowsEvent{}
	}
	if !down {
		return windowsEvent{}
	}
	control := session.Pressed[0xA2] || session.Pressed[0xA3]
	shift := session.Pressed[0x10] || session.Pressed[0xA0] || session.Pressed[0xA1]
	alt := flags&0x20 != 0 || session.Pressed[0xA4] || session.Pressed[0xA5]
	win := session.Pressed[0x5B] || session.Pressed[0x5C]
	action, name := windowsKeyName(key, control, alt, shift, win, session.Pressed[0xA5])
	return windowsEvent{Action: action, Key: name}
}

func (session *windowsHookSession) enqueue(event windowsEvent) {
	event.Window, _, _ = getForegroundWindow.Call()
	event.ObservedAt = time.Now()
	select {
	case session.Events <- event:
	default:
		select {
		case session.Failure <- errWindowsQueueOverflow:
		default:
		}
	}
}

func windowsKeyboardHook(code int32, message uintptr, keyboard *windowsKeyboardData) uintptr {
	if code >= 0 && keyboard != nil {
		if session := activeWindowsHooks.Load(); session != nil && session.Capture {
			// KBDLLHOOKSTRUCT is trusted Win32 callback memory valid until return.
			event := session.keyEvent(keyboard.VirtualKey, keyboard.Flags, message == 0x0100 || message == 0x0104)
			if event.Action != "" {
				session.enqueue(event)
			}
		}
	}
	result, _, _ := callNextHook.Call(0, uintptr(code), message, uintptr(unsafe.Pointer(keyboard)))
	return result
}

func windowsMouseHook(code int32, message uintptr, mouse *windowsMouseData) uintptr {
	if code >= 0 && mouse != nil {
		if session := activeWindowsHooks.Load(); session != nil && session.Capture {
			// MSLLHOOKSTRUCT is inspected only for hit testing and wheel direction.
			switch message {
			case 0x0202:
				session.enqueue(windowsEvent{Action: "click", Point: mouse.Point})
			case 0x0205:
				session.enqueue(windowsEvent{Action: "click", Key: "RIGHT_CLICK", Point: mouse.Point})
			case 0x0208:
				session.enqueue(windowsEvent{Action: "click", Key: "MIDDLE_CLICK", Point: mouse.Point})
			case 0x020A, 0x020E:
				key := "UP"
				if int16(mouse.MouseData>>16) < 0 {
					key = "DOWN"
				}
				if message == 0x020E {
					key = "RIGHT"
					if int16(mouse.MouseData>>16) < 0 {
						key = "LEFT"
					}
				}
				session.enqueue(windowsEvent{Action: "scroll", Key: key})
			}
		}
	}
	result, _, _ := callNextHook.Call(0, uintptr(code), message, uintptr(unsafe.Pointer(mouse)))
	return result
}

func windowsUIAWorker(ctx context.Context, session *windowsHookSession, ready chan<- error, started <-chan struct{}, emit func(Operation), epochAt func(time.Time) uint64) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	client, err := newWindowsAutomation()
	if err != nil {
		ready <- err
		return err
	}
	defer client.close()
	ownIntegrity, err := windowsIntegrity(windows.CurrentProcess())
	if err != nil {
		failure := fmt.Errorf("Recorder integrity could not be checked: %w", err)
		ready <- failure
		return failure
	}
	doubleTime, _, _ := getDoubleClickTime.Call()
	doubleWidth, _, _ := getSystemMetrics.Call(36)
	doubleHeight, _, _ := getSystemMetrics.Call(37)
	ready <- nil
	select {
	case <-started:
	case <-ctx.Done():
		return nil
	}
	var previousWindow uintptr
	var pending *Operation
	var pendingEvent windowsEvent
	var pendingEpoch uint64
	flush := func() {
		if pending != nil {
			emit(*pending)
			pending = nil
		}
	}
	defer flush() // All cancellation and provider-error paths preserve the pending click.
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	lastDesktopCheck := time.Time{}
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if time.Since(lastDesktopCheck) >= 500*time.Millisecond {
				if err := windowsDesktopState(); err != nil {
					return err
				}
				lastDesktopCheck = time.Now()
			}
			if pending != nil && time.Since(pendingEvent.ObservedAt) >= time.Duration(doubleTime)*time.Millisecond {
				flush()
			}
			window, _, _ := getForegroundWindow.Call()
			if window == 0 || window == previousWindow {
				continue
			}
			flush()
			operation, _, err := windowsApplication(window, ownIntegrity)
			if err != nil {
				return err
			}
			previousWindow = window
			operation.Action, operation.ObservedAt = "focus", time.Now()
			emit(operation)
		case event := <-session.Events:
			if ctx.Err() != nil {
				return nil
			}
			var eventEpoch uint64
			if event.Action == "click" {
				// Resolve pause boundaries on this worker, never in the low-level
				// hook. A queued click keeps the epoch when it was observed.
				eventEpoch = epochAt(event.ObservedAt)
				if eventEpoch == 0 {
					flush()
					continue
				}
			}
			if event.Window == 0 {
				continue
			}
			if time.Since(event.ObservedAt) > 2*time.Second {
				return errors.New("Windows target lookup fell behind input; recording stopped before associating events with stale controls")
			}
			if err := windowsDesktopState(); err != nil {
				return err
			}
			if event.Action != "click" || event.Key != "" || event.Window != previousWindow {
				flush()
			}
			operation, pid, err := windowsApplication(event.Window, ownIntegrity)
			if err != nil {
				return err
			}
			if event.Window != previousWindow {
				previousWindow = event.Window
				focus := operation
				focus.Action, focus.ObservedAt = "focus", event.ObservedAt
				emit(focus)
			}
			operation.Action, operation.Key, operation.ObservedAt = event.Action, event.Key, event.ObservedAt
			if event.Action != "scroll" {
				operation.Target, err = client.target(event, pid)
				if err != nil {
					return err
				}
			}
			// Finish the event whose target has already been resolved. Shutdown
			// on the next iteration flushes it even if stop arrived during UIA.
			if event.Action == "input" && !operation.Target.Writable {
				continue
			}
			if event.Action == "key" && event.Key == "SPACE" && operation.Target.Writable {
				operation.Action, operation.Key = "input", ""
			}
			if event.Action == "paste" {
				operation.Action = "key"
				if operation.Target.Writable {
					operation.Action, operation.Key = "input", ""
				}
			}
			if event.Action == "click" && event.Key == "" {
				deltaX, deltaY := int64(event.Point.X)-int64(pendingEvent.Point.X), int64(event.Point.Y)-int64(pendingEvent.Point.Y)
				if deltaX < 0 {
					deltaX = -deltaX
				}
				if deltaY < 0 {
					deltaY = -deltaY
				}
				if pending != nil && pendingEpoch == eventEpoch && event.ObservedAt.Sub(pendingEvent.ObservedAt) <= time.Duration(doubleTime)*time.Millisecond && deltaX <= int64(doubleWidth)/2 && deltaY <= int64(doubleHeight)/2 {
					operation.Key, operation.ObservedAt = "DOUBLE_CLICK", pending.ObservedAt
					operation.Target = pending.Target
					pending = nil
					emit(operation)
				} else {
					flush()
					pending, pendingEvent, pendingEpoch = &operation, event, eventEpoch
				}
			} else {
				emit(operation)
			}
		}
	}
}

func capture(ctx context.Context, emit func(Operation), onReady func(), epochAt func(time.Time) uint64) (captureError error) {
	if err := windowsDesktopState(); err != nil {
		return err
	}
	session := &windowsHookSession{Capture: true, Events: make(chan windowsEvent, 64), Failure: make(chan error, 1)}
	if !activeWindowsHooks.CompareAndSwap(nil, session) {
		return errors.New("A Windows desktop recording is already active")
	}
	defer activeWindowsHooks.Store(nil)
	workerContext, cancel := context.WithCancel(ctx)
	ready := make(chan error, 1)
	worker := &windowsWorker{done: make(chan struct{})}
	started := make(chan struct{})
	go func() {
		worker.err = windowsUIAWorker(workerContext, session, ready, started, emit, epochAt)
		close(worker.done)
	}()
	defer func() {
		cancel()
		if errors.Is(captureError, context.Canceled) && ctx.Err() != nil {
			captureError = nil
		}
		// The service allows two seconds for shutdown. Reserve time for its
		// stdio-close handling, but do not exit before the worker flushes stdout.
		if err := worker.wait(1500 * time.Millisecond); err != nil && captureError == nil {
			captureError = err
		}
	}()
	select {
	case err := <-ready:
		if err != nil {
			return err
		}
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(4 * time.Second):
		return errors.New("Windows UI Automation initialization timed out")
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	var message windowsMessage
	peekMessage.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0, 0) // Create the thread queue before cancellation can post WM_QUIT.
	threadID := windows.GetCurrentThreadId()
	// Seed only side-specific modifiers. Generic held-state bits would remain
	// stuck when Win32 later reports a left/right key-up instead of a generic one.
	for _, key := range []uintptr{0x5B, 0x5C, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5} {
		state, _, _ := getAsyncKeyState.Call(key)
		session.Pressed[key] = uint16(state)&0x8000 != 0
	}
	module, _, _ := getModuleHandle.Call(0)
	keyboard, _, err := setWindowsHook.Call(13, keyboardHookCallback, module, 0)
	if keyboard == 0 {
		return fmt.Errorf("Windows keyboard monitoring is unavailable: %w. %s", err, windowsPermissionHelp)
	}
	defer unhookWindowsHook.Call(keyboard)
	mouse, _, err := setWindowsHook.Call(14, mouseHookCallback, module, 0)
	if mouse == 0 {
		return fmt.Errorf("Windows mouse monitoring is unavailable: %w. %s", err, windowsPermissionHelp)
	}
	defer unhookWindowsHook.Call(mouse)
	failure := make(chan error, 1)
	monitorStop, monitorFinished := make(chan struct{}), make(chan struct{})
	defer func() { close(monitorStop); <-monitorFinished }()
	go func() {
		defer close(monitorFinished)
		var reason error
		select {
		case <-monitorStop:
			return
		case <-workerContext.Done():
			// Explicit stop and interrupts are normal shutdown, not capture errors.
		case reason = <-session.Failure:
		case <-worker.done:
			reason = worker.err
		}
		failure <- reason
		select {
		case <-monitorStop:
			return
		default:
		}
		postThreadMessage.Call(uintptr(threadID), 0x0012, 0, 0) // WM_QUIT only; never sends application input.
	}()
	onReady()
	close(started)
	for {
		result, _, err := getMessage.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		if int32(result) == -1 {
			cancel()
			return fmt.Errorf("Windows recorder message loop failed: %w", err)
		}
		if result == 0 {
			break
		}
	}
	cancel()
	select {
	case err := <-failure:
		return err
	default:
		return nil
	}
}
