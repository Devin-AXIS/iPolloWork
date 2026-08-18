"""Incremental SSE parsing.

Separate from the HTTP client and written as a pure parser, because the failure it has
to survive is a network chunk boundary landing in the middle of a frame — a bug that
only appears under load and cannot be tested if the parsing lives inside a read loop.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import IO, Iterator, List, Optional


@dataclass(frozen=True)
class SseEvent:
    event: str
    data: str
    id: Optional[str] = None


class SseParser:
    """Feed raw text in, get whole frames out."""

    def __init__(self) -> None:
        self._buffer = ""

    def push(self, chunk: str) -> List[SseEvent]:
        self._buffer += chunk
        # Normalize CRLF and lone CR so frame splitting is uniform.
        self._buffer = self._buffer.replace("\r\n", "\n").replace("\r", "\n")

        events: List[SseEvent] = []
        while True:
            boundary = self._buffer.find("\n\n")
            if boundary == -1:
                break
            raw = self._buffer[:boundary]
            self._buffer = self._buffer[boundary + 2 :]
            event = _parse_frame(raw)
            if event is not None:
                events.append(event)
        return events

    def flush(self) -> List[SseEvent]:
        """Emit a trailing frame that was never terminated by a blank line."""
        raw, self._buffer = self._buffer, ""
        event = _parse_frame(raw)
        return [event] if event is not None else []


def _parse_frame(raw: str) -> Optional[SseEvent]:
    if not raw.strip():
        return None

    event = "message"
    event_id: Optional[str] = None
    data: List[str] = []

    for line in raw.split("\n"):
        if not line or line.startswith(":"):
            continue
        field, sep, value = line.partition(":")
        if not sep:
            field, value = line, ""
        if value.startswith(" "):
            value = value[1:]

        if field == "event":
            event = value
        elif field == "data":
            data.append(value)
        elif field == "id":
            event_id = value

    if not data and event == "message":
        return None
    return SseEvent(event=event, data="\n".join(data), id=event_id)


def read_sse_stream(stream: IO[bytes], chunk_size: int = 8192) -> Iterator[SseEvent]:
    """Yield frames from a byte stream (an ``http.client.HTTPResponse``, typically)."""
    parser = SseParser()
    decoder_buffer = b""
    while True:
        chunk = stream.read(chunk_size)
        if not chunk:
            break
        decoder_buffer += chunk
        # Decode only complete UTF-8 sequences; a multi-byte character can straddle
        # a chunk boundary, and decoding eagerly would corrupt it.
        try:
            text = decoder_buffer.decode("utf-8")
            decoder_buffer = b""
        except UnicodeDecodeError as exc:
            text = decoder_buffer[: exc.start].decode("utf-8")
            decoder_buffer = decoder_buffer[exc.start :]
        for event in parser.push(text):
            yield event
    for event in parser.flush():
        yield event
