package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"os/signal"
	"strings"
	"sync"
	"time"
)

// The Windows and Linux helpers share the same bounded wire protocol as Swift.
// Platform adapters observe inputs; none of these types can carry captured values.
type Capabilities struct {
	Supported       bool   `json:"supported"`
	Accessibility   bool   `json:"accessibility"`
	InputMonitoring bool   `json:"inputMonitoring"`
	Backend         string `json:"backend,omitempty"`
	SessionType     string `json:"sessionType,omitempty"`
	Reason          string `json:"reason,omitempty"`
	PermissionHelp  string `json:"permissionHelp,omitempty"`
}

type Target struct {
	Role     string `json:"role"`
	Name     string `json:"name"`
	Secret   bool   `json:"-"`
	Writable bool   `json:"-"`
}

type Operation struct {
	Action, App, BundleID, Window string
	Target                        *Target
	Key                           string
	ObservedAt                    time.Time
}

type Step struct {
	ID       string  `json:"id"`
	At       string  `json:"at"`
	Action   string  `json:"action"`
	App      string  `json:"app"`
	BundleID string  `json:"bundleId"`
	Window   string  `json:"window"`
	Target   *Target `json:"target,omitempty"`
	Key      string  `json:"key,omitempty"`
	Secret   bool    `json:"secret,omitempty"`
}

type Event struct {
	Type    string `json:"type"`
	Step    *Step  `json:"step,omitempty"`
	Status  string `json:"status,omitempty"`
	Message string `json:"message,omitempty"`
}

type Recorder struct {
	mu         sync.Mutex
	encoder    *json.Encoder
	cancel     context.CancelFunc
	paused     bool
	pauses     []pauseInterval
	lastInput  string
	lastScroll time.Time
	count      int
	stopped    bool
}

type pauseInterval struct{ start, end time.Time }

// A delayed native click belongs to when it happened, not when double-click
// detection finishes. Epochs also prevent merging clicks across a pause.
func (r *Recorder) epochAtLocked(at time.Time) uint64 {
	if at.IsZero() {
		at = time.Now()
	}
	epoch := uint64(1)
	for _, interval := range r.pauses {
		if at.Before(interval.start) {
			break
		}
		if interval.end.IsZero() || at.Before(interval.end) {
			return 0
		}
		epoch++
	}
	return epoch
}

func (r *Recorder) epochAt(at time.Time) uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.epochAtLocked(at)
}

func label(value string) string {
	runes := []rune(strings.ReplaceAll(value, "\n", " "))
	if len(runes) > 160 {
		runes = runes[:160]
	}
	return string(runes)
}

func (r *Recorder) emitLocked(event Event) {
	if r.encoder.Encode(event) != nil {
		r.cancel()
	}
}

func (r *Recorder) operation(operation Operation) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopped || r.epochAtLocked(operation.ObservedAt) == 0 {
		return
	}
	switch operation.Action {
	case "focus", "click", "key", "input", "scroll":
	default:
		return
	}
	if operation.Action == "input" {
		if operation.Target == nil || (!operation.Target.Writable && !operation.Target.Secret) {
			return
		}
		identity := operation.App + ":" + operation.Target.Role + ":" + operation.Target.Name
		if operation.Key != "PASTE" && r.lastInput == identity {
			return
		}
		r.lastInput = identity
		operation.Key = ""
	} else {
		r.lastInput = ""
	}
	now := time.Now()
	if operation.Action == "scroll" {
		if now.Sub(r.lastScroll) < 800*time.Millisecond {
			return
		}
		r.lastScroll = now
	}
	if r.count >= 500 {
		r.stopped = true
		r.emitLocked(Event{Type: "limit", Message: "录制已达到 500 步，请停止并整理。"})
		r.cancel()
		return
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		r.cancel()
		return
	}
	observed := operation.ObservedAt
	if observed.IsZero() {
		observed = now
	}
	step := Step{ID: hex.EncodeToString(id[:]), At: observed.UTC().Format(time.RFC3339Nano), Action: operation.Action,
		App: label(operation.App), BundleID: label(operation.BundleID), Window: "Window", Key: operation.Key}
	if operation.Target != nil {
		target := *operation.Target
		target.Role, target.Name = label(target.Role), label(target.Name)
		if target.Secret {
			target.Name = "受保护的输入框"
			// Modified printable keys (including AltGr) must never expose a
			// protected field's content through the shortcut metadata channel.
			if operation.Action == "key" {
				parts := strings.Split(step.Key, "+")
				last := parts[len(parts)-1]
				if len(last) == 1 {
					return
				}
			}
		}
		step.Target, step.Secret = &target, target.Secret
	}
	r.count++
	r.emitLocked(Event{Type: "step", Step: &step})
}

func (r *Recorder) command(command string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopped {
		return
	}
	switch command {
	case "pause":
		if !r.paused {
			if len(r.pauses) >= 1024 {
				r.stopped = true
				r.emitLocked(Event{Type: "limit", Message: "录制已达到暂停次数上限，请停止并整理。"})
				r.cancel()
				return
			}
			r.pauses = append(r.pauses, pauseInterval{start: time.Now()})
		}
		r.paused, r.lastInput = true, ""
		r.emitLocked(Event{Type: "state", Status: "paused"})
	case "resume":
		if r.paused {
			r.pauses[len(r.pauses)-1].end = time.Now()
		}
		r.paused, r.lastInput, r.lastScroll = false, "", time.Time{}
		r.emitLocked(Event{Type: "state", Status: "recording"})
	case "stop":
		r.cancel()
	}
}

func run(input io.Reader, output io.Writer) int {
	capability := platformCapabilities()
	encoder := json.NewEncoder(output)
	if len(os.Args) > 1 && (os.Args[1] == "--check" || os.Args[1] == "--request-permissions") {
		if encoder.Encode(capability) != nil {
			return 1
		}
		return 0
	}
	if !capability.Supported || !capability.Accessibility || !capability.InputMonitoring {
		if capability.Reason == "" {
			capability.Reason = capability.PermissionHelp
		}
		_ = encoder.Encode(Event{Type: "error", Message: capability.Reason})
		return 2
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	recorder := &Recorder{encoder: encoder, cancel: cancel}
	go func() {
		scanner := bufio.NewScanner(input)
		scanner.Buffer(make([]byte, 4096), 4096)
		for scanner.Scan() {
			var command struct {
				Command string `json:"command"`
			}
			if json.Unmarshal(scanner.Bytes(), &command) == nil {
				recorder.command(command.Command)
			}
		}
		cancel()
	}()
	if err := capture(ctx, recorder.operation, func() {
		recorder.mu.Lock()
		recorder.emitLocked(Event{Type: "ready"})
		recorder.mu.Unlock()
	}, recorder.epochAt); err != nil {
		recorder.mu.Lock()
		recorder.emitLocked(Event{Type: "error", Message: label(err.Error())})
		recorder.mu.Unlock()
		return 2
	}
	return 0
}

func main() { os.Exit(run(os.Stdin, os.Stdout)) }
