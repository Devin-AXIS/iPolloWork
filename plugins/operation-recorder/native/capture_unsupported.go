//go:build !linux && !windows

package main

import (
	"context"
	"errors"
	"time"
)

func platformCapabilities() Capabilities {
	return Capabilities{Reason: "This platform uses the separate Swift recorder."}
}
func capture(ctx context.Context, emit func(Operation), onReady func(), epochAt func(time.Time) uint64) error {
	return errors.New("Windows or Linux helper required")
}
