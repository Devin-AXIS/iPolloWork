export type TransitionState = "idle" | "switching" | "recovering" | "failed";

export type RenderSource = "cache" | "live" | "empty" | "error" | "recovering";

export type SessionRenderModel = {
  intendedSessionId: string;
  renderedSessionId: string | null;
  transitionState: TransitionState;
  renderSource: RenderSource;
};

export function deriveSessionRenderModel(input: {
  intendedSessionId: string;
  renderedSessionId: string | null;
  hasSnapshot: boolean;
  isFetching: boolean;
  isError: boolean;
}): SessionRenderModel {
  if (input.isError && input.renderedSessionId && input.renderedSessionId !== input.intendedSessionId) {
    return {
      intendedSessionId: input.intendedSessionId,
      renderedSessionId: input.renderedSessionId,
      transitionState: "recovering",
      renderSource: "recovering",
    };
  }

  if (input.isError) {
    return {
      intendedSessionId: input.intendedSessionId,
      renderedSessionId: input.renderedSessionId,
      transitionState: "failed",
      renderSource: "error",
    };
  }

  if (input.renderedSessionId && input.renderedSessionId !== input.intendedSessionId) {
    return {
      intendedSessionId: input.intendedSessionId,
      renderedSessionId: input.renderedSessionId,
      transitionState: "switching",
      renderSource: "cache",
    };
  }

  if (!input.hasSnapshot) {
    return {
      intendedSessionId: input.intendedSessionId,
      renderedSessionId: input.renderedSessionId,
      transitionState: input.isFetching ? "switching" : "idle",
      renderSource: "empty",
    };
  }

  return {
    intendedSessionId: input.intendedSessionId,
    renderedSessionId: input.renderedSessionId,
    // A background snapshot refresh must not lock the composer once the
    // intended session is already on screen. Treating every refetch as a
    // route transition temporarily disabled Enter while leaving the editor
    // editable, so a send keystroke was inserted as a newline instead.
    transitionState: "idle",
    renderSource: "live",
  };
}
