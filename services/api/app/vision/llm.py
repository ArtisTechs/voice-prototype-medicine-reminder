"""Stage 4 (optional): Claude vision picks one of the patient's medicines or "none".

Off unless ANTHROPIC_API_KEY is set and VISION_LLM_FALLBACK=true. Sends only the photo and the list
"id: name strength" (no patient data). Any error, refusal or timeout counts as "none"."""

import base64
import json

import anthropic

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)
_client: anthropic.AsyncAnthropic | None = None

PROMPT = """This photo was taken by a pillbox camera. It shows a medicine package.
Which of these medicines is it? Answer with the id, or "none" if it is not clearly one of them.
Only choose a medicine if its name on the package matches; a similar-looking box is not enough.

{options}"""


def enabled() -> bool:
    return get_settings().llm_enabled


def client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=get_settings().anthropic_api_key, max_retries=0)
    return _client


async def choose(image: bytes, candidates: list[tuple[int, str]], timeout: float) -> int | None:
    """Returns a medicine id, or None. `timeout` is the hard per-request limit in seconds."""
    ids = [str(mid) for mid, _ in candidates]
    options = "\n".join(f"{mid}: {label}" for mid, label in candidates)
    try:
        response = await client().with_options(timeout=timeout, max_retries=0).beta.messages.create(
            model=get_settings().vision_llm_model,
            max_tokens=1024,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={
                "effort": "low",
                "format": {
                    "type": "json_schema",
                    "schema": {
                        "type": "object",
                        "properties": {"choice": {"type": "string", "enum": [*ids, "none"]}},
                        "required": ["choice"],
                        "additionalProperties": False,
                    },
                },
            },
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": base64.standard_b64encode(image).decode("ascii"),
                            },
                        },
                        {"type": "text", "text": PROMPT.format(options=options)},
                    ],
                }
            ],
        )
    except anthropic.APITimeoutError:
        log.warning("llm_timeout")
        return None
    except anthropic.RateLimitError:
        log.warning("llm_rate_limited")
        return None
    except anthropic.APIStatusError as e:
        log.warning("llm_api_error", status=e.status_code)
        return None
    except anthropic.APIConnectionError:
        log.warning("llm_connection_error")
        return None
    if response.stop_reason != "end_turn":
        log.info("llm_no_answer", stop_reason=response.stop_reason)
        return None
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        choice = json.loads(text)["choice"]
    except (ValueError, KeyError, TypeError):
        return None
    return int(choice) if choice in ids else None
