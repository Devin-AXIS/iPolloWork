"""Official Python client for the iPolloWork public API.

Depends only on the standard library, so it drops into a CI job or a script without
pulling anything in.
"""

from .client import IPolloWorkClient
from .errors import IPolloWorkApiError
from .sse import SseEvent, SseParser

__all__ = [
    "IPolloWorkClient",
    "IPolloWorkApiError",
    "SseEvent",
    "SseParser",
    "__version__",
]

__version__ = "0.1.0"
