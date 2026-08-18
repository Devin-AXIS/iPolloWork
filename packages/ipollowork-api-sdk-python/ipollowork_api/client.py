"""HTTP client for the iPolloWork public API.

Standard library only (``urllib``), so the SDK installs with no dependencies.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterator, List, Optional

from .errors import IPolloWorkApiError
from .sse import read_sse_stream

DEFAULT_TIMEOUT = 30.0
TERMINAL_TASK_STATES = frozenset({"done", "failed", "cancelled"})

# Distinguishes "caller said nothing" from "caller asked for no timeout at all".
# A long-lived SSE stream needs the latter, and ``None`` is how urllib spells it.
_UNSET = object()


class IPolloWorkClient:
    """Client for a running ``ipollowork-server``.

    Example::

        client = IPolloWorkClient("http://127.0.0.1:8787", token="...")
        created = client.create_session("my-workspace")
        session_id = created["session"]["id"]
        client.prompt_text("my-workspace", session_id, "Summarize README.md")
        for event in client.stream_session("my-workspace", session_id):
            if event.get("type") == "session.idle":
                break
    """

    def __init__(
        self,
        base_url: str,
        *,
        token: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        opener: Optional[urllib.request.OpenerDirector] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        if not base_url or not base_url.strip():
            raise ValueError("base_url is required")
        self.base_url = base_url.strip().rstrip("/")
        self.token = token.strip() if token and token.strip() else None
        self.timeout = timeout
        # Injectable so tests exercise the real request-building path without a network.
        self._opener = opener or urllib.request.build_opener()
        self._headers = dict(headers or {})

    # ------------------------------------------------------------- transport

    def _build_request(
        self,
        path: str,
        *,
        method: str = "GET",
        body: Any = None,
        query: Optional[Dict[str, Any]] = None,
        stream: bool = False,
    ) -> urllib.request.Request:
        url = f"{self.base_url}{path}"
        if query:
            filtered = {k: v for k, v in query.items() if v is not None}
            if filtered:
                url = f"{url}?{urllib.parse.urlencode(filtered)}"

        data = None
        headers = {"accept": "text/event-stream" if stream else "application/json"}
        headers.update(self._headers)
        if self.token:
            headers["authorization"] = f"Bearer {self.token}"
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["content-type"] = "application/json"

        return urllib.request.Request(url, data=data, headers=headers, method=method)

    def _open(self, request: urllib.request.Request, *, timeout: Any = _UNSET) -> Any:
        path = urllib.parse.urlparse(request.full_url).path
        effective = self.timeout if timeout is _UNSET else timeout
        try:
            return self._opener.open(request, timeout=effective)
        except urllib.error.HTTPError as exc:
            raise IPolloWorkApiError.from_response(exc.code, exc.read(), path) from None

    def _request(
        self,
        path: str,
        *,
        method: str = "GET",
        body: Any = None,
        query: Optional[Dict[str, Any]] = None,
    ) -> Any:
        response = self._open(self._build_request(path, method=method, body=body, query=query))
        try:
            status = getattr(response, "status", 200)
            raw = response.read()
        finally:
            response.close()
        if status == 204 or not raw:
            return None
        return json.loads(raw.decode("utf-8"))

    # --------------------------------------------------------------- service

    def health(self) -> Dict[str, Any]:
        return self._request("/api/v1/health")

    def whoami(self) -> Dict[str, Any]:
        return self._request("/api/v1/whoami")

    def list_modules(self) -> Dict[str, Any]:
        return self._request("/api/v1/modules")

    def openapi(self) -> Dict[str, Any]:
        return self._request("/api/v1/openapi.json")

    def list_workspaces(self) -> Dict[str, Any]:
        return self._request("/api/v1/workspaces")

    # -------------------------------------------------------------- sessions

    def create_session(
        self,
        workspace_id: str,
        *,
        title: Optional[str] = None,
        agent: Optional[str] = None,
        model: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Create a session.

        Returns the envelope ``{"session": {...}, "engine": str, "capabilities": {...}}``.
        The capabilities are worth reading before assuming ``?after=`` resumption or a
        ``system`` prompt will work — the engines differ.
        """
        body = {k: v for k, v in {"title": title, "agent": agent, "model": model}.items() if v is not None}
        return self._request(f"/api/v1/workspaces/{_enc(workspace_id)}/sessions", method="POST", body=body)

    def get_session(self, workspace_id: str, session_id: str) -> Dict[str, Any]:
        return self._request(f"/api/v1/workspaces/{_enc(workspace_id)}/sessions/{_enc(session_id)}")

    def delete_session(self, workspace_id: str, session_id: str) -> None:
        self._request(
            f"/api/v1/workspaces/{_enc(workspace_id)}/sessions/{_enc(session_id)}",
            method="DELETE",
        )

    def prompt(
        self,
        workspace_id: str,
        session_id: str,
        *,
        parts: List[Dict[str, Any]],
        model: Optional[Dict[str, str]] = None,
        agent: Optional[str] = None,
        system: Optional[str] = None,
        delivery: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"parts": parts}
        for key, value in (("model", model), ("agent", agent), ("system", system), ("delivery", delivery)):
            if value is not None:
                body[key] = value
        return self._request(
            f"/api/v1/workspaces/{_enc(workspace_id)}/sessions/{_enc(session_id)}/prompt",
            method="POST",
            body=body,
        )

    def prompt_text(self, workspace_id: str, session_id: str, text: str, **kwargs: Any) -> Dict[str, Any]:
        """Send a single text message."""
        return self.prompt(workspace_id, session_id, parts=[{"type": "text", "text": text}], **kwargs)

    def interrupt(self, workspace_id: str, session_id: str) -> Dict[str, Any]:
        return self._request(
            f"/api/v1/workspaces/{_enc(workspace_id)}/sessions/{_enc(session_id)}/interrupt",
            method="POST",
        )

    def list_permissions(self, workspace_id: str, session_id: str) -> Dict[str, Any]:
        return self._request(f"/api/v1/workspaces/{_enc(workspace_id)}/sessions/{_enc(session_id)}/permissions")

    def reply_permission(self, workspace_id: str, session_id: str, permission_id: str, reply: str) -> None:
        if reply not in ("once", "always", "reject"):
            raise ValueError("reply must be 'once', 'always' or 'reject'")
        self._request(
            f"/api/v1/workspaces/{_enc(workspace_id)}/sessions/{_enc(session_id)}"
            f"/permissions/{_enc(permission_id)}",
            method="POST",
            body={"reply": reply},
        )

    def list_questions(self, workspace_id: str, session_id: str) -> Dict[str, Any]:
        return self._request(f"/api/v1/workspaces/{_enc(workspace_id)}/sessions/{_enc(session_id)}/questions")

    def reply_question(
        self,
        workspace_id: str,
        session_id: str,
        question_id: str,
        answers: List[List[str]],
    ) -> None:
        self._request(
            f"/api/v1/workspaces/{_enc(workspace_id)}/sessions/{_enc(session_id)}"
            f"/questions/{_enc(question_id)}",
            method="POST",
            body={"answers": answers},
        )

    def stream_session(
        self,
        workspace_id: str,
        session_id: str,
        *,
        after: Optional[str] = None,
    ) -> Iterator[Dict[str, Any]]:
        """Yield normalized session events.

        Pass the ``seq`` of the last event you handled as ``after`` to resume a dropped
        connection without losing events.
        """
        request = self._build_request(
            f"/api/v1/workspaces/{_enc(workspace_id)}/sessions/{_enc(session_id)}/events",
            query={"after": after},
            stream=True,
        )
        # A long-lived stream must not inherit the per-request timeout.
        response = self._open(request, timeout=None)
        try:
            for frame in read_sse_stream(response):
                event = _parse_event(frame.event, frame.data, frame.id)
                if event is not None:
                    yield event
        finally:
            response.close()

    # ----------------------------------------------------------------- tasks

    def create_task(
        self,
        workspace_id: str,
        *,
        goal: str,
        agent: Optional[str] = None,
        model: Optional[Dict[str, str]] = None,
        approval_policy: Optional[str] = None,
        timeout_ms: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"goal": goal}
        for key, value in (
            ("agent", agent),
            ("model", model),
            ("approvalPolicy", approval_policy),
            ("timeoutMs", timeout_ms),
            ("metadata", metadata),
        ):
            if value is not None:
                body[key] = value
        return self._request(f"/api/v1/workspaces/{_enc(workspace_id)}/tasks", method="POST", body=body)

    def list_tasks(self, workspace_id: str, *, state: Optional[str] = None) -> Dict[str, Any]:
        return self._request(f"/api/v1/workspaces/{_enc(workspace_id)}/tasks", query={"state": state})

    def get_task(self, workspace_id: str, task_id: str) -> Dict[str, Any]:
        return self._request(f"/api/v1/workspaces/{_enc(workspace_id)}/tasks/{_enc(task_id)}")

    def cancel_task(self, workspace_id: str, task_id: str) -> Dict[str, Any]:
        return self._request(
            f"/api/v1/workspaces/{_enc(workspace_id)}/tasks/{_enc(task_id)}/cancel",
            method="POST",
        )

    def stream_task(self, workspace_id: str, task_id: str) -> Iterator[Dict[str, Any]]:
        request = self._build_request(
            f"/api/v1/workspaces/{_enc(workspace_id)}/tasks/{_enc(task_id)}/events",
            stream=True,
        )
        response = self._open(request, timeout=None)
        try:
            for frame in read_sse_stream(response):
                yield {"event": frame.event, "data": _safe_json(frame.data)}
        finally:
            response.close()

    def run_task(self, workspace_id: str, *, goal: str, on_event: Any = None, **kwargs: Any) -> Dict[str, Any]:  # noqa: D417
        """Submit a task and block until it reaches a terminal state.

        Follows the event stream rather than polling, then re-reads the task so a run
        that finished before the stream attached is still reported correctly.
        """
        task = self.create_task(workspace_id, goal=goal, **kwargs)
        if task.get("state") in TERMINAL_TASK_STATES:
            return task

        for event in self.stream_task(workspace_id, task["id"]):
            if on_event is not None:
                on_event(event["event"], event["data"])
            state = _read_state(event["data"])
            if state in TERMINAL_TASK_STATES:
                break

        return self.get_task(workspace_id, task["id"])

    # -------------------------------------------------------------- webhooks

    def create_webhook(
        self,
        workspace_id: str,
        *,
        url: str,
        events: List[str],
        secret: Optional[str] = None,
        active: bool = True,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"url": url, "events": events, "active": active}
        if secret is not None:
            body["secret"] = secret
        return self._request(f"/api/v1/workspaces/{_enc(workspace_id)}/webhooks", method="POST", body=body)

    def list_webhooks(self, workspace_id: str) -> Dict[str, Any]:
        return self._request(f"/api/v1/workspaces/{_enc(workspace_id)}/webhooks")

    def delete_webhook(self, workspace_id: str, webhook_id: str) -> None:
        self._request(
            f"/api/v1/workspaces/{_enc(workspace_id)}/webhooks/{_enc(webhook_id)}",
            method="DELETE",
        )


def _enc(value: str) -> str:
    return urllib.parse.quote(str(value), safe="")


def _safe_json(value: str) -> Any:
    try:
        return json.loads(value)
    except ValueError:
        return value


def _parse_event(event_name: str, data: str, event_id: Optional[str]) -> Optional[Dict[str, Any]]:
    parsed = _safe_json(data)
    if not isinstance(parsed, dict):
        return None
    if not isinstance(parsed.get("type"), str):
        if not event_name:
            return None
        parsed["type"] = event_name
    if event_id is not None and "seq" not in parsed:
        parsed["seq"] = event_id
    return parsed


def _read_state(data: Any) -> Optional[str]:
    if not isinstance(data, dict):
        return None
    state = data.get("state")
    if isinstance(state, str):
        return state
    task = data.get("task")
    if isinstance(task, dict) and isinstance(task.get("state"), str):
        return task["state"]
    return None
