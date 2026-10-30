"""JSON line logging. Log ids, counts and timings only: never names, emails, tokens or OCR text."""

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

REDACT_KEYS = {"password", "token", "access", "refresh", "email", "name", "text", "authorization", "body"}


def redact(fields: dict[str, Any]) -> dict[str, Any]:
    return {k: ("[redacted]" if k.lower() in REDACT_KEYS else v) for k, v in fields.items()}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "event": record.getMessage(),
        }
        data.update(getattr(record, "fields", {}))
        if record.exc_info:
            data["exc"] = self.formatException(record.exc_info)
        return json.dumps(data, default=str)


class Logger:
    def __init__(self, name: str):
        self._log = logging.getLogger(name)

    def _emit(self, level: int, event: str, exc_info: bool = False, **fields: Any) -> None:
        if self._log.isEnabledFor(level):
            self._log.log(level, event, exc_info=exc_info, extra={"fields": redact(fields)})

    def debug(self, event: str, **f: Any) -> None:
        self._emit(logging.DEBUG, event, **f)

    def info(self, event: str, **f: Any) -> None:
        self._emit(logging.INFO, event, **f)

    def warning(self, event: str, **f: Any) -> None:
        self._emit(logging.WARNING, event, **f)

    def error(self, event: str, **f: Any) -> None:
        self._emit(logging.ERROR, event, **f)

    def exception(self, event: str, **f: Any) -> None:
        self._emit(logging.ERROR, event, exc_info=True, **f)


def get_logger(name: str) -> Logger:
    return Logger(name)


def setup_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # uvicorn access logs include query strings (ws ?token=...), so keep them off.
    logging.getLogger("uvicorn.access").disabled = True
    for noisy in ("httpx", "apscheduler.executors.default", "PIL"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
