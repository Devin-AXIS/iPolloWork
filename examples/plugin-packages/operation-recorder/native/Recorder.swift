import AppKit
@preconcurrency import ApplicationServices
import Foundation

// Passive recording only: this process never sends input or replays coordinates.
func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}

func permissions() -> [String: Any] {
    ["supported": true, "accessibility": AXIsProcessTrusted(), "inputMonitoring": CGPreflightListenEventAccess()]
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}

func textAttribute(_ element: AXUIElement, _ name: String) -> String {
    guard let text = attribute(element, name) as? String else { return "" }
    return String(text.replacingOccurrences(of: "\n", with: " ").prefix(160))
}

func elementAttribute(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = attribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return unsafeDowncast(value, to: AXUIElement.self)
}

@MainActor
final class Recorder {
    private var tap: CFMachPort?
    private var paused = false
    private var previousContext = ""
    private var previousInputTarget = ""
    private var commandBuffer = Data()
    private var count = 0
    private var lastScroll: TimeInterval = 0

    func start() {
        let mask = (CGEventMask(1) << CGEventType.leftMouseUp.rawValue)
            | (CGEventMask(1) << CGEventType.rightMouseUp.rawValue)
            | (CGEventMask(1) << CGEventType.keyDown.rawValue)
            | (CGEventMask(1) << CGEventType.scrollWheel.rawValue)
        tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
            eventsOfInterest: mask, callback: { _, type, event, pointer in
                if let pointer {
                    let recorder = Unmanaged<Recorder>.fromOpaque(pointer).takeUnretainedValue()
                    MainActor.assumeIsolated { recorder.handle(type, event) }
                }
                return Unmanaged.passUnretained(event)
            }, userInfo: Unmanaged.passUnretained(self).toOpaque())
        guard let tap else {
            emit(["type": "error", "message": "请在系统设置中允许辅助功能和输入监控，然后重新开始录制。"])
            exit(2)
        }
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        FileHandle.standardInput.readabilityHandler = { handle in
            let data = handle.availableData
            DispatchQueue.main.async { self.commands(data) }
        }
        _ = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { _ in
            MainActor.assumeIsolated { self.observeContext() }
        }
        emit(["type": "ready"])
        observeContext()
        CFRunLoopRun()
    }

    private func commands(_ data: Data) {
        if data.isEmpty { stop(); return }
        commandBuffer.append(data)
        if commandBuffer.count > 4096 { stop(); return }
        while let newline = commandBuffer.firstIndex(of: 10) {
            let line = commandBuffer.subdata(in: commandBuffer.startIndex..<newline)
            commandBuffer.removeSubrange(commandBuffer.startIndex...newline)
            guard let value = try? JSONSerialization.jsonObject(with: line) as? [String: String] else { continue }
            switch value["command"] {
            case "pause": paused = true; previousInputTarget = ""
            case "resume": paused = false; previousContext = ""; observeContext()
            case "stop": stop()
            default: break
            }
        }
    }

    private func stop() {
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        FileHandle.standardInput.readabilityHandler = nil
        CFRunLoopStop(CFRunLoopGetMain())
    }

    private func context() -> (NSRunningApplication, AXUIElement, String)? {
        guard !paused, let app = NSWorkspace.shared.frontmostApplication,
            app.processIdentifier != ProcessInfo.processInfo.processIdentifier else { return nil }
        let root = AXUIElementCreateApplication(app.processIdentifier)
        let window = elementAttribute(root, kAXFocusedWindowAttribute)
        // Window titles can contain document content. Keep an app-level scope instead.
        let scope = window.map { textAttribute($0, kAXRoleAttribute) } ?? "AXWindow"
        return (app, root, scope)
    }

    private func observeContext() {
        guard let (app, _, window) = context() else { return }
        let key = "\(app.processIdentifier):\(window)"
        if key == previousContext { return }
        previousContext = key
        previousInputTarget = ""
        step("focus", app: app, window: window)
    }

    private func target(_ element: AXUIElement?) -> (role: String, name: String, secret: Bool) {
        guard let element else { return ("unknown", "", false) }
        let role = textAttribute(element, kAXRoleAttribute)
        let subrole = textAttribute(element, kAXSubroleAttribute)
        let secure = subrole.localizedCaseInsensitiveContains("secure")
        if secure { return (role, "受保护的输入框", true) }
        // AXValue and key characters are deliberately never read or retained.
        let title = textAttribute(element, kAXTitleAttribute)
        let description = textAttribute(element, kAXDescriptionAttribute)
        let name = title.isEmpty ? description : title
        let labelLooksSecret = name.range(of: "password|passwd|token|secret|密码|密钥|验证码", options: .regularExpression) != nil
        return (role, labelLooksSecret ? "受保护的输入框" : name, labelLooksSecret)
    }

    private func step(_ action: String, app: NSRunningApplication, window: String,
                      target: (role: String, name: String, secret: Bool)? = nil, key: String? = nil) {
        if count >= 500 { emit(["type": "limit", "message": "录制已达到 500 步，请停止并整理。"]); stop(); return }
        count += 1
        var value: [String: Any] = ["id": UUID().uuidString.lowercased(),
            "at": ISO8601DateFormatter().string(from: Date()), "action": action,
            "app": app.localizedName ?? "Application", "bundleId": app.bundleIdentifier ?? "", "window": window]
        if let target {
            value["target"] = ["role": target.role, "name": target.name]
            if target.secret { value["secret"] = true }
        }
        if let key { value["key"] = key }
        emit(["type": "step", "step": value])
    }

    private func handle(_ type: CGEventType, _ event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            // Fail closed; a disabled tap is never silently restarted.
            emit(["type": "error", "message": "系统暂停了输入监听，请重新开始录制。"])
            stop(); return
        }
        guard let (app, root, window) = context() else { return }
        observeContext()
        if type == .leftMouseUp || type == .rightMouseUp {
            var element: AXUIElement?
            let point = event.location
            AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &element)
            previousInputTarget = ""
            let clickKind = type == .rightMouseUp ? "RIGHT_CLICK"
                : event.getIntegerValueField(.mouseEventClickState) > 1 ? "DOUBLE_CLICK" : nil
            step("click", app: app, window: window, target: target(element), key: clickKind)
        } else if type == .keyDown {
            let focused = elementAttribute(root, kAXFocusedUIElementAttribute)
            let semantic = target(focused)
            let code = event.getIntegerValueField(.keyboardEventKeycode)
            let keys: [Int64: String] = [36: "ENTER", 48: "TAB", 53: "ESCAPE", 123: "ARROWLEFT", 124: "ARROWRIGHT", 125: "ARROWDOWN", 126: "ARROWUP"]
            let command = event.flags.contains(.maskCommand)
            let control = event.flags.contains(.maskControl)
            // Recognize paste without reading clipboard contents; retain only known control shortcuts.
            if command && code == 9 {
                previousInputTarget = ""
                step("input", app: app, window: window, target: semantic)
            } else if let key = keys[code] {
                previousInputTarget = ""
                let modifier = command ? "CMD+" : control ? "CTRL+" : event.flags.contains(.maskShift) ? "SHIFT+" : ""
                step("key", app: app, window: window, target: semantic, key: modifier + key)
            } else if command || control {
                let shortcuts: [Int64: String] = [0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 6: "Z", 7: "X", 8: "C", 12: "Q", 13: "W", 14: "E", 15: "R", 17: "T", 31: "O", 35: "P", 37: "L", 45: "N"]
                if let shortcut = shortcuts[code] {
                    previousInputTarget = ""
                    let modifier = command ? "CMD+" : "CTRL+"
                    step("key", app: app, window: window, target: semantic,
                        key: modifier + (event.flags.contains(.maskShift) ? "SHIFT+" : "") + shortcut)
                }
            } else {
                let writable = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"].contains(semantic.role)
                guard writable || semantic.secret else { return }
                let identity = "\(app.processIdentifier):\(semantic.role):\(semantic.name)"
                if previousInputTarget != identity {
                    previousInputTarget = identity
                    step("input", app: app, window: window, target: semantic)
                }
            }
        } else if type == .scrollWheel {
            let now = Date.timeIntervalSinceReferenceDate
            if now - lastScroll < 0.8 { return }
            lastScroll = now
            let vertical = event.getIntegerValueField(.scrollWheelEventDeltaAxis1)
            step("scroll", app: app, window: window, key: vertical >= 0 ? "UP" : "DOWN")
        }
    }
}

setbuf(stdout, nil)
let argument = CommandLine.arguments.dropFirst().first
if argument == "--check" {
    emit(permissions())
} else if argument == "--request-permissions" {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
    _ = CGRequestListenEventAccess()
    emit(permissions())
} else if !AXIsProcessTrusted() || !CGPreflightListenEventAccess() {
    emit(["type": "error", "message": "需要辅助功能和输入监控权限。录制不会读取输入内容或截取屏幕。"])
    exit(2)
} else {
    Recorder().start()
}
