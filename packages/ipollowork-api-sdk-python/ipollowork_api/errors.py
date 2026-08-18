"""Error type for the iPolloWork API."""

from __future__ import annotations

import json
from typing import Any, Optional


class IPolloWorkApiError(Exception):
    """A non-2xx response.

    The server always answers with ``{code, message, details}``. Branch on ``code``:
    it is part of the contract, while ``message`` is free text that may change.
    """

    def __init__(
        self,
        *,
        status: int,
        code: str,
        message: str,
        details: Any = None,
        request_path: str = "",
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details
        self.request_path = request_path

    @property
    def is_retryable(self) -> bool:
        """True for transient upstream and rate-limit conditions."""
        return self.status in (429, 502, 503, 504)

    @property
    def is_auth_error(self) -> bool:
        """True when the token is missing, expired, or lacks the required scope."""
        return self.status in (401, 403)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (
            f"IPolloWorkApiError(status={self.status!r}, code={self.code!r}, "
            f"message={self.message!r}, path={self.request_path!r})"
        )

    @classmethod
    def from_response(cls, status: int, body: bytes, request_path: str) -> "IPolloWorkApiError":
        code = f"http_{status}"
        message = "Request failed"
        details: Optional[Any] = None
        try:
            parsed = json.loads(body.decode("utf-8"))
            if isinstance(parsed, dict):
                if isinstance(parsed.get("code"), str):
                    code = parsed["code"]
                if isinstance(parsed.get("message"), str):
                    message = parsed["message"]
                details = parsed.get("details")
        except (ValueError, UnicodeDecodeError):
            # A proxy error page rather than the API's JSON body.
            pass
        return cls(
            status=status,
            code=code,
            message=message,
            details=details,
            request_path=request_path,
        )
