import * as React from 'react';

export function createPollScheduler({ setTimeoutFn, clearTimeoutFn }) {
  let disposed = false;
  let timer;

  return {
    get disposed() {
      return disposed;
    },
    schedule(callback, delayMs) {
      if (disposed) return false;
      if (timer !== undefined) clearTimeoutFn(timer);
      timer = setTimeoutFn(() => {
        timer = undefined;
        if (!disposed) void callback();
      }, delayMs);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== undefined) clearTimeoutFn(timer);
      timer = undefined;
    },
  };
}

export function createAnimationFrameScheduler({ requestFrame, cancelFrame }) {
  let disposed = false;
  const frames = new Set();
  const keyedFrames = new Map();

  return {
    schedule(callback, key) {
      if (disposed) return false;
      const previous = key === undefined ? undefined : keyedFrames.get(key);
      if (previous !== undefined) {
        keyedFrames.delete(key);
        frames.delete(previous);
        cancelFrame(previous);
      }
      let frame;
      let completed = false;
      frame = requestFrame(() => {
        completed = true;
        if (frame !== undefined) frames.delete(frame);
        if (key !== undefined && keyedFrames.get(key) === frame) keyedFrames.delete(key);
        if (!disposed) callback();
      });
      if (!completed) {
        frames.add(frame);
        if (key !== undefined) keyedFrames.set(key, frame);
      }
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const frame of frames) cancelFrame(frame);
      frames.clear();
      keyedFrames.clear();
    },
  };
}

export function useAnimationFrameScheduler() {
  const schedulerRef = React.useRef(null);

  React.useEffect(() => {
    const scheduler = createAnimationFrameScheduler({
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (frame) => window.cancelAnimationFrame(frame),
    });
    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, []);

  return React.useCallback(
    (callback, key) => schedulerRef.current?.schedule(callback, key) ?? false,
    [],
  );
}
