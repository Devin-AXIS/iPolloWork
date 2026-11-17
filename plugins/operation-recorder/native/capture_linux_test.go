//go:build linux

package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"net"
	"testing"
	"time"
)

func linuxTestAuthority(family uint16, address, display, name string, cookie []byte) []byte {
	var value bytes.Buffer
	binary.Write(&value, binary.BigEndian, family)
	for _, field := range [][]byte{[]byte(address), []byte(display), []byte(name), cookie} {
		binary.Write(&value, binary.BigEndian, uint16(len(field)))
		value.Write(field)
	}
	return value.Bytes()
}

func TestLinuxSessionRejectsWaylandAndHeadless(t *testing.T) {
	for _, test := range []struct {
		session, wayland, display string
		supported                 bool
	}{
		{"x11", "", ":0", true}, {"", "", ":1", true}, {"wayland", "", ":0", false}, {"x11", "wayland-0", ":0", false}, {"", "", "", false}, {"tty", "", ":0", false},
	} {
		_, err := linuxSessionType(test.session, test.wayland, test.display)
		if (err == nil) != test.supported {
			t.Fatalf("incorrect session detection for %q", test.session)
		}
	}
	for _, display := range []string{"hostname:0", "tcp/host:1", ":-1", ":999999", "oops"} {
		if _, err := linuxDisplayNumber(display); err == nil {
			t.Fatalf("accepted unsupported DISPLAY %q", display)
		}
	}
}

func TestLinuxAuthoritySelectsOnlyCurrentLocalDisplay(t *testing.T) {
	wanted := bytes.Repeat([]byte{42}, 16)
	wrong := bytes.Repeat([]byte{19}, 16)
	data := append(linuxTestAuthority(256, "host", "1", "MIT-MAGIC-COOKIE-1", wrong), linuxTestAuthority(256, "host", "0", "MIT-MAGIC-COOKIE-1", wanted)...)
	cookie, err := linuxAuthority(bytes.NewReader(data), "0", "host")
	if err != nil || !bytes.Equal(cookie, wanted) {
		t.Fatal("did not select the matching local cookie")
	}
	if _, err := linuxAuthority(bytes.NewReader(data), "0", "other-host"); err == nil {
		t.Fatal("accepted another host's local cookie")
	}
	if _, err := linuxAuthority(bytes.NewReader(data[:7]), "0", "host"); err == nil {
		t.Fatal("accepted truncated credentials")
	}
}

func TestLinuxSensitiveRolesNeverUseAccessibleNames(t *testing.T) {
	for _, role := range []uint32{40, 61, 77, 79, 11, 12, 52} {
		target := linuxRole(role, true)
		if linuxSafeNameRole(target.Role) {
			t.Fatalf("sensitive input role %d permits captured names", role)
		}
		if !target.Writable {
			t.Fatalf("input role %d is not writable", role)
		}
	}
	password := linuxRole(40, true)
	if !password.Secret || password.Name != "受保护的输入框" {
		t.Fatal("password is not explicitly masked")
	}
	if linuxRole(79, false).Writable {
		t.Fatal("readonly entries are writable")
	}
	if linuxSafeNameRole("unknown") || linuxSafeNameRole("window") {
		t.Fatal("unknown or document window titles can be read")
	}
}

func TestLinuxKeysDescribeInputWithoutCapturingText(t *testing.T) {
	keys := linuxKeyMap{symbols: map[byte]uint32{1: 'p', 2: 0xffe3, 3: 'v', 4: 0xff0d}, modifiers: make(map[byte]bool)}
	target := &Target{Role: "password", Secret: true, Writable: true}
	if action, key := keys.operation(1, true, target); action != "input" || key != "" {
		t.Fatal("printable input was exposed or not recognized")
	}
	keys.operation(2, true, target)
	if action, key := keys.operation(3, true, target); action != "input" || key != "PASTE" {
		t.Fatal("paste did not become an input variable")
	}
	keys.operation(2, false, target)
	if action, key := keys.operation(4, true, target); action != "key" || key != "ENTER" {
		t.Fatal("semantic Enter key lost")
	}
	if action, _ := keys.operation(1, true, &Target{Role: "unknown"}); action != "" {
		t.Fatal("unknown printable input was captured")
	}
}

func TestLinuxAltGrNeverBecomesCapturedCharacterShortcut(t *testing.T) {
	for _, modifier := range []uint32{0xfe03, 0xfe11, 0xff7e} {
		keys := linuxKeyMap{symbols: map[byte]uint32{1: modifier, 2: 'q', 3: 0xff51}, modifiers: make(map[byte]bool)}
		keys.operation(1, true, nil)
		if action, key := keys.operation(2, true, &Target{Secret: true, Writable: true}); action != "input" || key != "" {
			t.Fatal("AltGr password character escaped as a shortcut")
		}
		if action, key := keys.operation(2, true, &Target{Role: "unknown"}); action != "" || key != "" {
			t.Fatal("unknown AltGr character was serialized")
		}
		if action, key := keys.operation(3, true, &Target{Writable: true}); action != "key" || key != "LEFT" {
			t.Fatal("AltGr removed a safe navigation key")
		}
	}
	keys := linuxKeyMap{symbols: map[byte]uint32{1: 0xffe3, 2: 0xffea, 3: 'v', 4: 0xff54}, modifiers: make(map[byte]bool)}
	keys.operation(1, true, nil)
	keys.operation(2, true, nil)
	if action, key := keys.operation(3, true, &Target{Writable: true}); action != "input" || key != "" {
		t.Fatal("Ctrl+Alt character was misclassified as a paste/shortcut")
	}
	if action, key := keys.operation(4, true, &Target{Writable: true}); action != "key" || key != "CTRL+ALT+DOWN" {
		t.Fatal("Ctrl+Alt lost safe navigation semantics")
	}
}

func TestLinuxPointerActionsPreserveButtonAndDirection(t *testing.T) {
	for _, test := range []struct {
		button      byte
		action, key string
	}{
		{1, "click", ""}, {2, "click", "MIDDLE_CLICK"}, {3, "click", "RIGHT_CLICK"},
		{4, "scroll", "UP"}, {5, "scroll", "DOWN"}, {6, "scroll", "LEFT"}, {7, "scroll", "RIGHT"}, {8, "", ""},
	} {
		action, key := linuxPointerAction(test.button)
		if action != test.action || key != test.key {
			t.Fatalf("button %d lost its click/scroll semantics", test.button)
		}
	}
}

func linuxTestReply(sequence uint16, category byte, payload []byte) []byte {
	value := make([]byte, 32+len(payload))
	value[0] = 1
	value[1] = category
	binary.LittleEndian.PutUint16(value[2:4], sequence)
	binary.LittleEndian.PutUint32(value[4:8], uint32(len(payload)/4))
	copy(value[32:], payload)
	return value
}

func TestLinuxRecordWireStreamsRepeatedReplies(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	wire := newLinuxRecordWire(context.Background(), client)
	wire.setup, wire.enabled, wire.enableSequence = true, true, 7
	first := linuxTestReply(7, 4, nil)
	keypress := make([]byte, 32)
	keypress[0], keypress[1] = 2, 55
	click := make([]byte, 32)
	click[0], click[1] = 4, 1
	normal := linuxTestReply(8, 0, []byte{8, 9, 10, 11})
	go func() {
		for _, packet := range [][]byte{first, linuxTestReply(7, 0, keypress), linuxTestReply(7, 0, click), normal} {
			if _, err := server.Write(packet); err != nil {
				return
			}
		}
	}()
	client.SetDeadline(time.Now().Add(time.Second))
	received := make([]byte, 32)
	if _, err := io.ReadFull(wire, received); err != nil || !bytes.Equal(received, first) {
		t.Fatalf("first reply did not reach xgb: %v", err)
	}
	received = make([]byte, len(normal))
	if _, err := io.ReadFull(wire, received); err != nil || !bytes.Equal(received, normal) {
		t.Fatalf("normal reply changed: %v", err)
	}
	for _, kind := range []byte{2, 4} {
		select {
		case packet := <-wire.packets:
			if packet.bytes[32] != kind || packet.at.IsZero() {
				t.Fatal("stream event or receive timestamp was lost")
			}
		default:
			t.Fatal("subsequent RECORD reply was not streamed")
		}
	}
}

func TestLinuxRecordWireBoundsReplyAllocation(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	wire := newLinuxRecordWire(context.Background(), client)
	wire.setup = true
	header := linuxTestReply(1, 0, nil)
	binary.LittleEndian.PutUint32(header[4:8], linuxPacketLimit/4+1)
	go server.Write(header)
	if _, err := wire.Read(make([]byte, 32)); err == nil {
		t.Fatal("oversized reply accepted")
	}
}

func TestLinuxRecordWirePreservesHandshakeAndRequestSequence(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	wire := newLinuxRecordWire(context.Background(), client)
	wire.opcode = 170
	setup := make([]byte, 16)
	setup[0] = 1
	binary.LittleEndian.PutUint16(setup[6:8], 2)
	go func() { server.Write(setup); io.Copy(io.Discard, server) }()
	actual := make([]byte, 16)
	if _, err := io.ReadFull(wire, actual[:8]); err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadFull(wire, actual[8:]); err != nil || !bytes.Equal(actual, setup) {
		t.Fatal("handshake bytes changed")
	}
	wire.Write(make([]byte, 12)) // Authentication setup is not an X11 sequence.
	wire.Write([]byte{98, 0, 2, 0, 0, 0, 0, 0})
	wire.Write([]byte{170, 5, 2, 0, 1, 0, 0, 0})
	if wire.enableSequence != 2 || !wire.enabled {
		t.Fatal("EnableContext sequence is incorrect")
	}
}

func linuxTestXSettings(order binary.ByteOrder, settings map[string]int32) []byte {
	var data bytes.Buffer
	header := make([]byte, 12)
	if order == binary.BigEndian {
		header[0] = 1
	}
	order.PutUint32(header[4:8], 9)
	order.PutUint32(header[8:12], uint32(len(settings)))
	data.Write(header)
	for name, value := range settings {
		header := make([]byte, 4)
		order.PutUint16(header[2:4], uint16(len(name)))
		data.Write(header)
		data.WriteString(name)
		data.Write(make([]byte, (-len(name))&3))
		binary.Write(&data, order, uint32(8))
		binary.Write(&data, order, value)
	}
	return data.Bytes()
}

func TestLinuxXSettingsUsesBothRealThresholdsWithoutDefaults(t *testing.T) {
	for _, order := range []binary.ByteOrder{binary.LittleEndian, binary.BigEndian} {
		data := linuxTestXSettings(order, map[string]int32{"Net/DoubleClickTime": 437, "Net/DoubleClickDistance": 11})
		settings, valid := linuxParseDoubleSettings(data)
		if !valid || settings.milliseconds != 437 || settings.distance != 11 || settings.serial != 9 {
			t.Fatal("real desktop threshold was not preserved")
		}
		if _, valid := linuxParseDoubleSettings(data[:len(data)-1]); valid {
			t.Fatal("truncated desktop settings accepted")
		}
	}
	for _, settings := range []map[string]int32{{"Net/DoubleClickTime": 437}, {"Net/DoubleClickTime": 0, "Net/DoubleClickDistance": 11}, {"Net/DoubleClickTime": 437, "Net/DoubleClickDistance": -1}} {
		if _, valid := linuxParseDoubleSettings(linuxTestXSettings(binary.LittleEndian, settings)); valid {
			t.Fatal("incomplete/invalid settings substituted with guessed defaults")
		}
	}
}

func linuxTestClick(at uint32, x int16, window uint32, ref linuxAccessibleRef, settings linuxDoubleSettings) linuxClickSnapshot {
	return linuxClickSnapshot{button: 1, epoch: 1, serverTime: at, x: x, y: 12, window: window, ref: ref, settings: settings, validSettings: true, operation: Operation{Action: "click", Target: &Target{Role: "button", Name: "Open"}, ObservedAt: time.Now()}}
}

func TestLinuxDoubleClickRequiresCurrentSettingsAndExactSemanticTarget(t *testing.T) {
	settings := linuxDoubleSettings{milliseconds: 430, distance: 5, serial: 7, owner: 99}
	ref := linuxAccessibleRef{Bus: ":1.5", Path: "/button"}
	first := linuxTestClick(100, 12, 21, ref, settings)
	second := linuxTestClick(200, 15, 21, ref, settings)
	merger := linuxClickMerger{}
	if got := merger.add(first); len(got) != 0 {
		t.Fatal("first click was not deferred for the real threshold")
	}
	merger.focus = append(merger.focus, Operation{Action: "focus"})
	got := merger.add(second)
	if len(got) != 2 || got[0].Key != "DOUBLE_CLICK" || got[1].Action != "focus" {
		t.Fatal("a proven double click/focus sequence was lost")
	}
	for _, alter := range []func(*linuxClickSnapshot){
		func(click *linuxClickSnapshot) { click.window++ }, func(click *linuxClickSnapshot) { click.ref.Path = "/other" },
		func(click *linuxClickSnapshot) { click.x = 100 }, func(click *linuxClickSnapshot) { click.serverTime = 700 },
		func(click *linuxClickSnapshot) { click.settings.serial++ }, func(click *linuxClickSnapshot) { click.validSettings = false },
		func(click *linuxClickSnapshot) { click.epoch++ },
	} {
		merger := linuxClickMerger{}
		merger.add(first)
		next := second
		alter(&next)
		got := append(merger.add(next), merger.flush()...)
		if len(got) != 2 || got[0].Key == "DOUBLE_CLICK" || got[1].Key == "DOUBLE_CLICK" {
			t.Fatal("unproven double click was invented")
		}
	}
}

func TestLinuxPausedClickFlushesPriorAndDoesNotConsumeResumedClick(t *testing.T) {
	settings := linuxDoubleSettings{milliseconds: 430, distance: 5}
	ref := linuxAccessibleRef{Bus: ":1.5", Path: "/button"}
	first := linuxTestClick(100, 12, 21, ref, settings)
	paused := linuxTestClick(150, 12, 21, ref, settings)
	paused.epoch = 0
	resumed := linuxTestClick(200, 12, 21, ref, settings)
	resumed.epoch = 2
	secondResumed := linuxTestClick(250, 12, 21, ref, settings)
	secondResumed.epoch = 2
	merger := linuxClickMerger{}
	merger.add(first)
	got := merger.add(paused)
	if len(got) != 1 || got[0].ObservedAt != first.operation.ObservedAt || got[0].Key != "" || merger.waiting != nil {
		t.Fatal("paused click was emitted or the preceding valid click was lost")
	}
	if got := merger.add(resumed); len(got) != 0 || merger.waiting == nil {
		t.Fatal("paused click consumed the first resumed click")
	}
	if got := merger.add(secondResumed); len(got) != 1 || got[0].Key != "DOUBLE_CLICK" || got[0].ObservedAt != resumed.operation.ObservedAt {
		t.Fatal("valid resumed clicks did not form a pair within their own epoch")
	}
}

func TestLinuxDoubleClickHandlesServerTimeWrapAndSingleClickExpiry(t *testing.T) {
	settings := linuxDoubleSettings{milliseconds: 430, distance: 5}
	ref := linuxAccessibleRef{Bus: ":1.5", Path: "/button"}
	merger := linuxClickMerger{}
	first := linuxTestClick(^uint32(0)-20, 12, 21, ref, settings)
	second := linuxTestClick(40, 12, 21, ref, settings)
	merger.add(first)
	if got := merger.add(second); len(got) != 1 || got[0].Key != "DOUBLE_CLICK" {
		t.Fatal("X11 time wrap lost a real double click")
	}
	merger.add(first)
	if got := merger.expires(first.operation.ObservedAt.Add(430 * time.Millisecond)); len(got) != 1 || got[0].Key != "" {
		t.Fatal("single click did not flush at the actual desktop threshold")
	}
	unknown := first
	unknown.validSettings = false
	if got := merger.add(unknown); len(got) != 1 {
		t.Fatal("missing settings unexpectedly deferred a click")
	}
}

func TestLinuxPendingClicksPreserveOrderAndFlushFinalStop(t *testing.T) {
	now := time.Now()
	first := linuxClickIdentity{at: 100, button: 1}
	second := linuxClickIdentity{at: 101, button: 3}
	pending := map[linuxClickIdentity]linuxPendingClick{
		second: {id: second, due: now.Add(time.Millisecond), order: 2},
		first:  {id: first, due: now.Add(-time.Millisecond), order: 1},
	}
	ready := linuxPendingReady(pending, now, false)
	if len(ready) != 1 || ready[0].id != first {
		t.Fatal("correlation wait emitted a click before its deadline")
	}
	ready = linuxPendingReady(pending, now, true)
	if len(ready) != 2 || ready[0].id != first || ready[1].id != second {
		t.Fatal("final stop dropped or reordered pending observed clicks")
	}
}
