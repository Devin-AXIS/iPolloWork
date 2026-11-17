//go:build windows && (amd64 || arm64)

package main

import (
	"context"
	"errors"
	"testing"
	"time"
	"unsafe"
)

func TestWindowsShutdownWaitsForWorkerCompletionAndRetainsFailures(t *testing.T) {
	worker := &windowsWorker{done: make(chan struct{})}
	flushed := false
	go func() {
		flushed = true
		worker.err = context.Canceled
		close(worker.done)
	}()
	if err := worker.wait(time.Second); err != nil || !flushed {
		t.Fatalf("normal stop did not wait for the worker's final output: %v", err)
	}
	failure := errors.New("provider failure")
	worker.err = failure
	if err := worker.wait(time.Second); !errors.Is(err, failure) {
		t.Fatalf("shutdown discarded a real worker failure: %v", err)
	}

	blocked := &windowsWorker{done: make(chan struct{})}
	started := time.Now()
	if err := blocked.wait(time.Millisecond); err == nil {
		t.Fatal("an unfinished worker was accepted as complete")
	}
	if time.Since(started) >= time.Second {
		t.Fatal("worker shutdown did not honor its deadline")
	}
}

func TestWindowsKnownKeysNeverExposeTypedCharacters(t *testing.T) {
	tests := []struct {
		key                      uint32
		control, alt, shift, win bool
		action, name             string
	}{
		{0x41, false, false, false, false, "input", ""},
		{0x41, false, false, true, false, "input", ""},
		{0x31, false, false, false, false, "input", ""},
		{0x11, true, false, false, false, "", ""},
		{0x56, true, false, false, false, "paste", "CTRL+V"},
		{0x56, true, false, true, false, "paste", "CTRL+SHIFT+V"},
		{0x2D, false, false, true, false, "paste", "SHIFT+INSERT"},
		{0x0D, true, false, true, false, "key", "CTRL+SHIFT+ENTER"},
		{0x09, false, true, true, false, "key", "ALT+SHIFT+TAB"},
		{0x73, false, true, false, false, "key", "ALT+F4"},
		{0x4C, false, false, false, true, "key", "WIN+L"},
		{0x31, true, false, false, false, "key", "CTRL+1"},
		{0x2E, true, true, false, false, "key", "CTRL+ALT+DELETE"},
		{0x87, false, false, false, false, "key", "F24"},
	}
	for _, test := range tests {
		action, name := windowsKeyName(test.key, test.control, test.alt, test.shift, test.win, false)
		if action != test.action || name != test.name {
			t.Errorf("key %#x: got %q/%q, want %q/%q", test.key, action, name, test.action, test.name)
		}
	}
}

func TestWindowsModifierSnapshotsAndAltGrPrivacy(t *testing.T) {
	for _, key := range []uint32{0x41, 0x5A, 0x31, 0x60, 0xBA, 0xDE, 0xE2} {
		for _, modifiers := range [][3]bool{{true, true, false}, {true, true, true}, {false, true, true}} {
			action, name := windowsKeyName(key, modifiers[0], modifiers[1], false, false, modifiers[2])
			if action != "input" || name != "" {
				t.Errorf("AltGr printable %#x retained a key identity: %q/%q", key, action, name)
			}
		}
	}
	session := &windowsHookSession{}
	session.Pressed[0xA2], session.Pressed[0xA5] = true, true // Modifiers held before capture starts.
	queued := session.keyEvent(0x51, 0x20, true)
	if queued.Action != "input" || queued.Key != "" {
		t.Fatal("initially held AltGr leaked a printable key")
	}
	session.keyEvent(0x12, 1, false) // Generic VK_MENU with extended bit means right Alt release.
	shortcut := session.keyEvent(0x58, 0, true)
	if shortcut.Action != "key" || shortcut.Key != "CTRL+X" {
		t.Fatalf("right Alt release left a modifier stuck: %#v", shortcut)
	}
	session.keyEvent(0x11, 0, false)
	plain := session.keyEvent(0x58, 0, true)
	if plain.Action != "input" || plain.Key != "" {
		t.Fatal("initially held control remained stuck after release")
	}
	if queued.Action != "input" || queued.Key != "" || shortcut.Key != "CTRL+X" {
		t.Fatal("later modifier transitions changed queued event semantics")
	}
	session.keyEvent(0xA5, 0, true)
	control := session.keyEvent(0x73, 0x20, true)
	if control.Action != "key" || control.Key != "ALT+F4" {
		t.Fatal("AltGr handling lost a non-printable control shortcut")
	}
}

func TestWindowsLabelsOnlyReadStableInteractiveRoles(t *testing.T) {
	for _, role := range []int32{50000, 50002, 50005, 50011, 50013, 50019, 50031} {
		if !windowsNamedControl(role) {
			t.Errorf("interactive role %d must support labels", role)
		}
	}
	for _, role := range []int32{50003, 50004, 50020, 50025, 50029, 50030, 50032, 50033, 59999} {
		if windowsNamedControl(role) {
			t.Errorf("content-bearing role %d must not expose Name", role)
		}
	}
}

func TestWindowsABIMatchesOfficialSDKSlotsAndHookLayouts(t *testing.T) {
	word := unsafe.Sizeof(uintptr(0))
	if word != 8 {
		t.Fatal("The Windows UIA backend requires amd64 or arm64")
	}
	automation := windowsAutomationVTable{}
	element := windowsElementVTable{}
	for name, values := range map[string][2]uintptr{
		"ElementFromPoint":   {unsafe.Offsetof(automation.ElementFromPoint), 7 * word},
		"GetFocusedElement":  {unsafe.Offsetof(automation.GetFocusedElement), 8 * word},
		"ConnectionTimeout":  {unsafe.Offsetof(automation.PutConnectionTimeout), 61 * word},
		"TransactionTimeout": {unsafe.Offsetof(automation.PutTransactionTimeout), 63 * word},
		"ProcessID":          {unsafe.Offsetof(element.CurrentProcessID), 20 * word},
		"ControlType":        {unsafe.Offsetof(element.CurrentControlType), 21 * word},
		"Name":               {unsafe.Offsetof(element.CurrentName), 23 * word},
		"IsPassword":         {unsafe.Offsetof(element.CurrentIsPassword), 35 * word},
	} {
		if values[0] != values[1] {
			t.Errorf("%s offset is %d, want %d", name, values[0], values[1])
		}
	}
	if unsafe.Sizeof(windowsKeyboardData{}) != 24 || unsafe.Sizeof(windowsMouseData{}) != 32 || unsafe.Sizeof(windowsMessage{}) != 48 || unsafe.Sizeof(windowsPoint{}) != 8 {
		t.Fatal("Windows hook or POINT ABI layout is invalid")
	}
}
