"""Gemini text-to-speech integration."""

from __future__ import annotations

import ast
import base64
import binascii
import os
import re

import httpx
from google import genai
from google.genai import types


class GeminiTTSNotConfiguredError(RuntimeError):
    """Raised when Gemini TTS is requested without a configured API key."""


class GeminiTTSTimeoutError(RuntimeError):
    """Raised when a Gemini TTS request times out."""


class GeminiTTSAuthenticationError(RuntimeError):
    """Raised when Gemini rejects the configured API key."""


class GeminiTTSQuotaError(RuntimeError):
    """Raised when Gemini rejects a request due to quota or rate limits."""


class GeminiTTSUnavailableError(RuntimeError):
    """Raised when Gemini is unavailable or cannot be reached."""


class GeminiTTSGenerationError(RuntimeError):
    """Raised when Gemini TTS fails to generate valid audio."""


class GeminiTTSService:
    def __init__(self) -> None:
        self.model = os.environ.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-lite-tts")
        self.voice = os.environ.get("GEMINI_TTS_VOICE", "Kore")
        self.timeout_seconds = int(os.environ.get("GEMINI_TTS_TIMEOUT_SECONDS", "30"))
        if self.timeout_seconds < 1:
            raise ValueError("GEMINI_TTS_TIMEOUT_SECONDS must be at least 1.")

        api_key = os.environ.get("GEMINI_API_KEY")
        self._api_key = api_key
        self._client = (
            genai.Client(
                api_key=api_key,
                http_options=types.HttpOptions(
                    api_version="v1beta",
                    timeout=self.timeout_seconds * 1000,
                ),
            )
            if api_key
            else None
        )

    def generate_wav(self, text: str) -> bytes:
        if self._client is None:
            raise GeminiTTSNotConfiguredError("GEMINI_API_KEY is not configured.")

        try:
            interaction = self._client.interactions.create(
                model=self.model,
                input=[
                    {
                        "type": "user_input",
                        "content": [{"type": "text", "text": text}],
                    }
                ],
                response_format={"type": "audio", "mime_type": "audio/wav"},
                generation_config={"speech_config": [{"voice": self.voice}]},
            )
        except (TimeoutError, httpx.TimeoutException) as error:
            raise GeminiTTSTimeoutError("Gemini TTS request timed out.") from error
        except httpx.TransportError as error:
            raise GeminiTTSUnavailableError(
                "Gemini TTS could not be reached."
            ) from error
        except Exception as error:
            code, status, message = self._provider_error_details(error)
            provider_status = f" (HTTP {code})" if code is not None else ""
            provider_detail = f"{provider_status}: {message}" if message else ""
            classification = f"{status} {message}".casefold()

            if (
                code in {400, 401, 403}
                and (
                    "api_key_invalid" in classification
                    or "api key not valid" in classification
                    or "invalid api key" in classification
                )
            ) or code in {401, 403} or status in {
                "UNAUTHENTICATED",
                "PERMISSION_DENIED",
            }:
                raise GeminiTTSAuthenticationError(
                    "Gemini rejected GEMINI_API_KEY. Replace it in the project-root "
                    ".env file with a valid Google AI Studio API key."
                    f"{provider_detail}"
                ) from error
            if (
                code == 429
                or status == "RESOURCE_EXHAUSTED"
                or "quota" in classification
            ):
                raise GeminiTTSQuotaError(
                    "Gemini TTS quota or rate limit was reached."
                    f"{provider_detail}"
                ) from error
            if type(error).__name__ == "APITimeoutError":
                raise GeminiTTSTimeoutError(
                    "Gemini TTS request timed out."
                    f"{provider_detail}"
                ) from error
            if (
                (code is not None and code >= 500)
                or status in {"UNAVAILABLE", "INTERNAL"}
                or type(error).__name__ == "APIConnectionError"
            ):
                raise GeminiTTSUnavailableError(
                    "Gemini TTS is temporarily unavailable."
                    f"{provider_detail}"
                ) from error

            raise GeminiTTSGenerationError(
                f"Gemini TTS request failed{provider_detail or f': {type(error).__name__}'}."
            ) from error

        audio_data = getattr(getattr(interaction, "output_audio", None), "data", None)
        if not isinstance(audio_data, str) or not audio_data:
            raise GeminiTTSGenerationError("Gemini TTS returned no audio.")

        try:
            audio_bytes = base64.b64decode(audio_data, validate=True)
        except (binascii.Error, ValueError) as error:
            raise GeminiTTSGenerationError("Gemini TTS returned invalid audio data.") from error
        if (
            len(audio_bytes) < 12
            or audio_bytes[:4] != b"RIFF"
            or audio_bytes[8:12] != b"WAVE"
        ):
            raise GeminiTTSGenerationError(
                "Gemini TTS did not return a valid WAV audio file."
            )
        return audio_bytes

    def _provider_error_details(self, error: Exception) -> tuple[int | None, str, str]:
        body = getattr(error, "body", None) or getattr(error, "details", None)
        raw_message = getattr(error, "message", "") or str(error)
        if not isinstance(body, (dict, list)):
            match = re.match(
                r"^Error code: \d+\s*-\s*(.+)$", str(raw_message), re.DOTALL
            )
            if match:
                try:
                    body = ast.literal_eval(match.group(1))
                except (SyntaxError, ValueError):
                    body = None
        if isinstance(body, list):
            body = body[-1] if body else {}
        provider_error = body.get("error", body) if isinstance(body, dict) else {}
        code = provider_error.get("code") if isinstance(provider_error, dict) else None
        code = (
            code
            or getattr(error, "status_code", None)
            or getattr(error, "code", None)
        )
        status = (
            provider_error.get("status", "")
            if isinstance(provider_error, dict)
            else ""
        ) or getattr(error, "status", "")
        message = (
            provider_error.get("message", "")
            if isinstance(provider_error, dict)
            else ""
        ) or raw_message
        safe_message = re.sub(r"[\r\n\t]+", " ", str(message)).strip()
        if self._api_key:
            safe_message = safe_message.replace(self._api_key, "[REDACTED]")
        return (
            code if isinstance(code, int) else None,
            str(status).upper(),
            safe_message[:500],
        )

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
