"""Tests for the iPolloWork Python SDK. Run with: python3 -m unittest discover -s tests"""

from __future__ import annotations

import io
import json
import os
import sys
import unittest
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ipollowork_api import IPolloWorkApiError, IPolloWorkClient, SseParser  # noqa: E402
from ipollowork_api.sse import read_sse_stream  # noqa: E402


class FakeResponse(io.BytesIO):
    def __init__(self, payload: bytes, status: int = 200) -> None:
        super().__init__(payload)
        self.status = status


class RecordingOpener:
    """Stands in for urllib's opener and records what the client sent."""

    def __init__(self, responder) -> None:
        self.responder = responder
        self.requests = []

    def open(self, request, timeout=None):
        self.requests.append((request, timeout))
        return self.responder(request)


def json_opener(payload, status=200):
    return RecordingOpener(lambda _req: FakeResponse(json.dumps(payload).encode(), status))


def session_envelope():
    """The exact envelope the server returns, so stubs cannot drift from it."""
    return {
        "session": {"id": "s1", "title": "Session one"},
        "engine": "opencode",
        "capabilities": {
            "streaming": True,
            "resumableStreaming": True,
            "permissions": True,
            "questions": True,
            "interrupt": True,
            "wait": True,
            "promptOptions": {"system": False, "reasoningEffort": False, "variant": True},
        },
    }


class SseParserTests(unittest.TestCase):
    def test_parses_single_frame(self):
        events = SseParser().push('event: a\ndata: {"x":1}\n\n')
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event, "a")
        self.assertEqual(events[0].data, '{"x":1}')

    def test_keeps_id(self):
        events = SseParser().push("id: 7\nevent: a\ndata: 1\n\n")
        self.assertEqual(events[0].id, "7")

    def test_reassembles_frame_split_across_chunks(self):
        parser = SseParser()
        self.assertEqual(parser.push("event: a\nda"), [])
        self.assertEqual(parser.push("ta: hello\n"), [])
        events = parser.push("\n")
        self.assertEqual(events[0].data, "hello")

    def test_multiple_frames_in_one_chunk(self):
        events = SseParser().push("event: a\ndata: 1\n\nevent: b\ndata: 2\n\n")
        self.assertEqual([e.event for e in events], ["a", "b"])

    def test_joins_multiple_data_lines(self):
        events = SseParser().push("event: log\ndata: one\ndata: two\n\n")
        self.assertEqual(events[0].data, "one\ntwo")

    def test_ignores_keepalive_comments(self):
        events = SseParser().push(": keepalive\n\nevent: a\ndata: 1\n\n")
        self.assertEqual(len(events), 1)

    def test_normalizes_crlf(self):
        events = SseParser().push("event: a\r\ndata: 1\r\n\r\n")
        self.assertEqual(events[0].data, "1")

    def test_strips_only_one_leading_space(self):
        events = SseParser().push("event: a\ndata:  two\n\n")
        self.assertEqual(events[0].data, " two")

    def test_flush_emits_unterminated_frame(self):
        parser = SseParser()
        self.assertEqual(parser.push("event: a\ndata: 1"), [])
        self.assertEqual(parser.flush()[0].data, "1")

    def test_flush_on_empty_buffer(self):
        self.assertEqual(SseParser().flush(), [])


class ReadSseStreamTests(unittest.TestCase):
    def test_yields_frames_in_order(self):
        stream = io.BytesIO(b"event: a\ndata: 1\n\nevent: b\ndata: 2\n\n")
        self.assertEqual([e.event for e in read_sse_stream(stream)], ["a", "b"])

    def test_survives_multibyte_split_across_chunks(self):
        # The frame carries a Chinese character whose UTF-8 bytes are split by the
        # 8-byte read size, which would corrupt it if decoded eagerly.
        payload = "event: a\ndata: 数据\n\n".encode("utf-8")
        stream = io.BytesIO(payload)
        events = list(read_sse_stream(stream, chunk_size=8))
        self.assertEqual(events[0].data, "数据")


class ClientTests(unittest.TestCase):
    def test_requires_base_url(self):
        with self.assertRaises(ValueError):
            IPolloWorkClient("   ")

    def test_sends_bearer_token_and_trims_base_url(self):
        opener = json_opener({"ok": True})
        IPolloWorkClient("http://host:8787/", token="tok", opener=opener).health()

        request, _timeout = opener.requests[0]
        self.assertEqual(request.full_url, "http://host:8787/api/v1/health")
        self.assertEqual(request.get_header("Authorization"), "Bearer tok")

    def test_omits_authorization_without_token(self):
        opener = json_opener({"ok": True})
        IPolloWorkClient("http://host", opener=opener).health()
        self.assertIsNone(opener.requests[0][0].get_header("Authorization"))

    def test_percent_encodes_path_segments(self):
        opener = json_opener(session_envelope())
        IPolloWorkClient("http://host", opener=opener).get_session("work space/1", "sess/2")

        self.assertTrue(
            opener.requests[0][0].full_url.endswith(
                "/api/v1/workspaces/work%20space%2F1/sessions/sess%2F2"
            )
        )

    def test_prompt_text_builds_documented_body(self):
        opener = json_opener({"messageId": "m1"})
        IPolloWorkClient("http://host", opener=opener).prompt_text("w1", "s1", "ship it", agent="build")

        request = opener.requests[0][0]
        self.assertEqual(request.method, "POST")
        self.assertEqual(
            json.loads(request.data.decode()),
            {"parts": [{"type": "text", "text": "ship it"}], "agent": "build"},
        )

    def test_drops_none_query_parameters(self):
        opener = json_opener({"items": []})
        IPolloWorkClient("http://host", opener=opener).list_tasks("w1")
        self.assertNotIn("?", opener.requests[0][0].full_url)

    def test_includes_query_parameters_when_set(self):
        opener = json_opener({"items": []})
        IPolloWorkClient("http://host", opener=opener).list_tasks("w1", state="running")
        self.assertIn("state=running", opener.requests[0][0].full_url)

    def test_rejects_invalid_permission_reply(self):
        client = IPolloWorkClient("http://host", opener=json_opener({}))
        with self.assertRaises(ValueError):
            client.reply_permission("w1", "s1", "p1", "allow")

    def test_create_session_returns_the_envelope(self):
        opener = json_opener(session_envelope())
        created = IPolloWorkClient("http://host", opener=opener).create_session("w1", title="Session one")

        # The id lives under "session"; reading it flat would send the next request to
        # /sessions/None/prompt.
        self.assertEqual(created["session"]["id"], "s1")
        self.assertEqual(created["engine"], "opencode")
        self.assertFalse(created["capabilities"]["promptOptions"]["system"])

    def test_list_permissions_uses_the_permissions_key(self):
        opener = json_opener({"permissions": [{"id": "p1"}]})
        result = IPolloWorkClient("http://host", opener=opener).list_permissions("w1", "s1")
        self.assertEqual(len(result["permissions"]), 1)

    def test_list_webhooks_never_returns_a_secret(self):
        opener = json_opener({"webhooks": [{"id": "wh1", "hasSecret": True}]})
        result = IPolloWorkClient("http://host", opener=opener).list_webhooks("w1")
        self.assertTrue(result["webhooks"][0]["hasSecret"])
        self.assertNotIn("secret", result["webhooks"][0])

    def test_maps_error_body_to_typed_error(self):
        def responder(request):
            raise urllib.error.HTTPError(
                request.full_url,
                404,
                "Not Found",
                {},
                io.BytesIO(json.dumps(
                    {"code": "session_not_found", "message": "Session not found", "details": {"id": "s1"}}
                ).encode()),
            )

        client = IPolloWorkClient("http://host", opener=RecordingOpener(responder))
        with self.assertRaises(IPolloWorkApiError) as ctx:
            client.get_session("w1", "s1")

        error = ctx.exception
        self.assertEqual(error.status, 404)
        self.assertEqual(error.code, "session_not_found")
        self.assertEqual(error.details, {"id": "s1"})
        self.assertFalse(error.is_retryable)
        self.assertEqual(error.request_path, "/api/v1/workspaces/w1/sessions/s1")

    def test_synthesizes_code_for_non_json_error(self):
        def responder(request):
            raise urllib.error.HTTPError(
                request.full_url, 502, "Bad Gateway", {}, io.BytesIO(b"<html>502</html>")
            )

        client = IPolloWorkClient("http://host", opener=RecordingOpener(responder))
        with self.assertRaises(IPolloWorkApiError) as ctx:
            client.health()

        self.assertEqual(ctx.exception.code, "http_502")
        self.assertTrue(ctx.exception.is_retryable)

    def test_classifies_auth_errors(self):
        def responder(request):
            raise urllib.error.HTTPError(
                request.full_url, 403, "Forbidden", {},
                io.BytesIO(json.dumps({"code": "forbidden", "message": "Insufficient token scope"}).encode()),
            )

        client = IPolloWorkClient("http://host", opener=RecordingOpener(responder))
        with self.assertRaises(IPolloWorkApiError) as ctx:
            client.health()

        self.assertTrue(ctx.exception.is_auth_error)

    def test_returns_none_for_204(self):
        opener = RecordingOpener(lambda _req: FakeResponse(b"", 204))
        self.assertIsNone(IPolloWorkClient("http://host", opener=opener).delete_session("w1", "s1"))

    def test_stream_session_applies_cursor_and_seq(self):
        frames = (
            b'id: 1\nevent: message.delta\ndata: {"type":"message.delta","sessionId":"s1"}\n\n'
            b": keepalive\n\n"
            b'id: 2\nevent: session.idle\ndata: {"type":"session.idle","sessionId":"s1"}\n\n'
        )
        opener = RecordingOpener(lambda _req: FakeResponse(frames))

        client = IPolloWorkClient("http://host", opener=opener)
        events = list(client.stream_session("w1", "s1", after="0"))

        self.assertIn("after=0", opener.requests[0][0].full_url)
        self.assertEqual(opener.requests[0][0].get_header("Accept"), "text/event-stream")
        self.assertEqual([e["type"] for e in events], ["message.delta", "session.idle"])
        self.assertEqual([e["seq"] for e in events], ["1", "2"])

    def test_stream_disables_the_request_timeout(self):
        opener = RecordingOpener(lambda _req: FakeResponse(b"event: a\ndata: {}\n\n"))
        list(IPolloWorkClient("http://host", opener=opener).stream_session("w1", "s1"))
        self.assertIsNone(opener.requests[0][1])

    def test_run_task_returns_immediately_when_already_terminal(self):
        opener = RecordingOpener(
            lambda _req: FakeResponse(json.dumps({"id": "t1", "state": "done"}).encode())
        )
        task = IPolloWorkClient("http://host", opener=opener).run_task("w1", goal="g")

        self.assertEqual(task["state"], "done")
        self.assertEqual(len(opener.requests), 1)

    def test_run_task_follows_stream_then_rereads(self):
        def responder(request):
            path = request.full_url
            if path.endswith("/tasks") and request.method == "POST":
                return FakeResponse(json.dumps({"id": "t1", "state": "queued"}).encode())
            if path.endswith("/events"):
                return FakeResponse(
                    b'event: task.updated\ndata: {"state":"running"}\n\n'
                    b'event: task.updated\ndata: {"state":"done"}\n\n'
                )
            return FakeResponse(json.dumps({"id": "t1", "state": "done"}).encode())

        opener = RecordingOpener(responder)
        seen = []
        task = IPolloWorkClient("http://host", opener=opener).run_task(
            "w1", goal="g", on_event=lambda _name, data: seen.append(data["state"])
        )

        self.assertEqual(seen, ["running", "done"])
        self.assertEqual(task["state"], "done")
        self.assertEqual(len(opener.requests), 3)


if __name__ == "__main__":
    unittest.main()
