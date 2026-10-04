package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"
)

func testRecorder(buffer *bytes.Buffer) *Recorder {
	return &Recorder{encoder: json.NewEncoder(buffer), cancel: func() {}}
}

func events(t *testing.T, buffer *bytes.Buffer) []Event {
	t.Helper()
	var result []Event
	for _, line := range strings.Split(strings.TrimSpace(buffer.String()), "\n") {
		if line == "" {
			continue
		}
		var event Event
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatal(err)
		}
		result = append(result, event)
	}
	return result
}

func TestInputPrivacyAndPauseBoundary(t *testing.T) {
	var buffer bytes.Buffer
	recorder := testRecorder(&buffer)
	target := &Target{Role: "Edit", Name: "Query", Writable: true}
	recorder.operation(Operation{Action: "input", App: "fixture", Target: target})
	recorder.operation(Operation{Action: "input", App: "fixture", Target: target})
	recorder.command("pause")
	duringPause := time.Now()
	recorder.operation(Operation{Action: "click", Target: &Target{Role: "Button", Name: "PausedOnly"}})
	recorder.command("resume")
	recorder.operation(Operation{Action: "input", Target: target, ObservedAt: duringPause})
	recorder.operation(Operation{Action: "input", App: "fixture", Target: target, ObservedAt: time.Now()})
	recorder.operation(Operation{Action: "input", Target: &Target{Role: "Edit", Name: "never-leak-sentinel", Secret: true}})
	recorder.operation(Operation{Action: "key", Key: "CTRL+ALT+Q", Target: &Target{Role: "Edit", Secret: true}})
	got := events(t, &buffer)
	if len(got) != 5 || got[1].Status != "paused" || got[2].Status != "recording" || !got[4].Step.Secret {
		t.Fatalf("unexpected events: %+v", got)
	}
	if strings.Contains(buffer.String(), "never-leak-sentinel") || strings.Contains(buffer.String(), "CTRL+ALT+Q") || strings.Contains(buffer.String(), "PausedOnly") || strings.Contains(buffer.String(), "Writable") {
		t.Fatal("private or paused data escaped")
	}
}

func TestConcurrentProtocolIsBoundedAndValid(t *testing.T) {
	var buffer bytes.Buffer
	recorder := testRecorder(&buffer)
	var workers sync.WaitGroup
	for range 8 {
		workers.Go(func() {
			for range 100 {
				recorder.operation(Operation{Action: "click", Target: &Target{Role: "Button", Name: "Confirm"}})
			}
		})
	}
	workers.Wait()
	got := events(t, &buffer)
	var count int
	for _, event := range got {
		if event.Type == "step" {
			count++
		}
	}
	if count != 500 {
		t.Fatalf("step count: %d", count)
	}
}

func TestDelayedClicksPreserveObservationTimeAcrossPauseEpochs(t *testing.T) {
	var buffer bytes.Buffer
	recorder := testRecorder(&buffer)
	before := time.Now()
	firstEpoch := recorder.epochAt(before)
	recorder.command("pause")
	during := time.Now()
	recorder.operation(Operation{Action: "click", ObservedAt: before, Target: &Target{Role: "Button", Name: "BeforePause"}})
	recorder.operation(Operation{Action: "click", ObservedAt: during, Target: &Target{Role: "Button", Name: "PausedOnly"}})
	recorder.command("resume")
	after := time.Now()
	if firstEpoch == 0 || recorder.epochAt(before) != firstEpoch || recorder.epochAt(during) != 0 || recorder.epochAt(after) <= firstEpoch {
		t.Fatal("pause interval lost its observation epochs")
	}
	recorder.operation(Operation{Action: "click", ObservedAt: during, Target: &Target{Role: "Button", Name: "LatePausedOnly"}})
	recorder.operation(Operation{Action: "click", ObservedAt: after, Target: &Target{Role: "Button", Name: "AfterResume"}})
	got := events(t, &buffer)
	if len(got) != 4 || got[1].Step == nil || got[1].Step.At != before.UTC().Format(time.RFC3339Nano) || got[3].Step.Target.Name != "AfterResume" {
		t.Fatalf("delayed pause boundary events were lost or fabricated: %+v", got)
	}
	if strings.Contains(buffer.String(), "PausedOnly") {
		t.Fatal("an operation observed while paused escaped")
	}
}

func TestPauseHistoryIsBounded(t *testing.T) {
	var buffer bytes.Buffer
	recorder := testRecorder(&buffer)
	for range 1025 {
		recorder.command("pause")
		recorder.command("resume")
	}
	if len(recorder.pauses) != 1024 || !recorder.stopped {
		t.Fatal("pause history exceeded its fixed recording limit")
	}
}
