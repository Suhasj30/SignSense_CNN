from __future__ import annotations

import base64
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from google.genai.errors import APIError
import httpx

from backend.app import app, load_backend_environment
from backend.tts_service import (
    GeminiTTSAuthenticationError,
    GeminiTTSGenerationError,
    GeminiTTSNotConfiguredError,
    GeminiTTSQuotaError,
    GeminiTTSService,
    GeminiTTSTimeoutError,
    GeminiTTSUnavailableError,
)

SAMPLE_WAV = b"RIFF\x00\x00\x00\x00WAVE"


class InteractionsAPIError(Exception):
    def __init__(self, body: object, message: str) -> None:
        super().__init__(message)
        self.status_code = 400
        self.body = body
        self.message = message


class APITimeoutError(Exception):
    pass


class BackendEnvironmentTests(unittest.TestCase):
    @patch.dict(os.environ, {}, clear=True)
    @patch("backend.tts_service.genai.Client")
    def test_loads_key_from_project_root_dotenv(self, client_factory: Mock) -> None:
        with TemporaryDirectory() as temporary_directory:
            project_root = Path(temporary_directory)
            (project_root / ".env").write_text(
                "GEMINI_API_KEY=automatic-test-key\n",
                encoding="utf-8",
            )
            with patch("backend.app.PROJECT_ROOT", project_root):
                load_backend_environment()
            service = GeminiTTSService()
            service.close()

        self.assertEqual(os.environ["GEMINI_API_KEY"], "automatic-test-key")
        client_factory.assert_called_once()
        self.assertEqual(
            client_factory.call_args.kwargs["api_key"],
            "automatic-test-key",
        )


class GeminiTTSServiceTests(unittest.TestCase):
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}, clear=True)
    @patch("backend.tts_service.genai.Client")
    def test_decodes_audio_from_gemini_interaction(self, client_factory: Mock) -> None:
        client = client_factory.return_value
        client.interactions.create.return_value = SimpleNamespace(
            output_audio=SimpleNamespace(data=base64.b64encode(SAMPLE_WAV).decode("ascii"))
        )

        service = GeminiTTSService()
        try:
            self.assertEqual(service.generate_wav("Hello."), SAMPLE_WAV)
        finally:
            service.close()

        client.interactions.create.assert_called_once_with(
            model="gemini-3.8-flash-lite-tts",
            input=[
                {
                    "type": "user_input",
                    "content": [{"type": "text", "text": "Hello."}],
                }
            ],
            response_format={"type": "audio", "mime_type": "audio/wav"},
            generation_config={"speech_config": [{"voice": "Kore"}]},
        )
        client.close.assert_called_once()

    @patch.dict(os.environ, {}, clear=True)
    def test_requires_api_key(self) -> None:
        service = GeminiTTSService()
        with self.assertRaises(GeminiTTSNotConfiguredError):
            service.generate_wav("Hello.")

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}, clear=True)
    @patch("backend.tts_service.genai.Client")
    def test_maps_provider_timeout(self, client_factory: Mock) -> None:
        service = GeminiTTSService()
        create = client_factory.return_value.interactions.create
        create.side_effect = TimeoutError
        with self.assertRaises(GeminiTTSTimeoutError):
            service.generate_wav("Hello.")
        create.side_effect = APITimeoutError("request timed out")
        with self.assertRaises(GeminiTTSTimeoutError):
            service.generate_wav("Hello.")
        service.close()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}, clear=True)
    @patch("backend.tts_service.genai.Client")
    def test_maps_invalid_key_and_quota_errors(self, client_factory: Mock) -> None:
        client = client_factory.return_value
        service = GeminiTTSService()
        invalid_key_body = [
            {
                "error": {
                    "code": 400,
                    "status": "INVALID_ARGUMENT",
                    "message": "API key not valid. Please pass a valid API key.",
                    "details": [{"reason": "API_KEY_INVALID"}],
                }
            },
        ]
        client.interactions.create.side_effect = InteractionsAPIError(
            invalid_key_body,
            f"Error code: 400 - {invalid_key_body!r}",
        )
        with self.assertRaisesRegex(
            GeminiTTSAuthenticationError, "valid Google AI Studio API key"
        ) as raised:
            service.generate_wav("Hello.")
        self.assertIn("Please pass a valid API key.", str(raised.exception))
        self.assertNotIn("details", str(raised.exception))

        client.interactions.create.side_effect = APIError(
            429,
            {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "Quota exceeded."}},
        )
        with self.assertRaises(GeminiTTSQuotaError):
            service.generate_wav("Hello.")
        service.close()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}, clear=True)
    @patch("backend.tts_service.genai.Client")
    def test_redacts_api_key_from_provider_error(self, client_factory: Mock) -> None:
        client_factory.return_value.interactions.create.side_effect = InteractionsAPIError(
            {"error": {"code": 400, "message": "Request failed using test-key"}},
            "Request failed using test-key",
        )
        service = GeminiTTSService()

        with self.assertRaises(GeminiTTSGenerationError) as raised:
            service.generate_wav("Hello.")

        self.assertNotIn("test-key", str(raised.exception))
        self.assertIn("[REDACTED]", str(raised.exception))
        service.close()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}, clear=True)
    @patch("backend.tts_service.genai.Client")
    def test_preserves_model_error_details(self, client_factory: Mock) -> None:
        client_factory.return_value.interactions.create.side_effect = InteractionsAPIError(
            {
                "error": {
                    "code": 404,
                    "status": "NOT_FOUND",
                    "message": "Model gemini-invalid-tts was not found.",
                }
            },
            "Model gemini-invalid-tts was not found.",
        )
        service = GeminiTTSService()

        with self.assertRaises(GeminiTTSGenerationError) as raised:
            service.generate_wav("Hello.")

        self.assertIn("HTTP 404", str(raised.exception))
        self.assertIn("Model gemini-invalid-tts was not found.", str(raised.exception))
        service.close()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}, clear=True)
    @patch("backend.tts_service.genai.Client")
    def test_maps_network_errors(self, client_factory: Mock) -> None:
        client_factory.return_value.interactions.create.side_effect = httpx.ConnectError(
            "offline"
        )
        service = GeminiTTSService()
        with self.assertRaises(GeminiTTSUnavailableError):
            service.generate_wav("Hello.")
        service.close()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}, clear=True)
    @patch("backend.tts_service.genai.Client")
    def test_rejects_malformed_audio(self, client_factory: Mock) -> None:
        client_factory.return_value.interactions.create.return_value = SimpleNamespace(
            output_audio=SimpleNamespace(data=base64.b64encode(b"not-a-wav").decode("ascii"))
        )
        service = GeminiTTSService()
        with self.assertRaisesRegex(GeminiTTSGenerationError, "valid WAV"):
            service.generate_wav("Hello.")
        service.close()


class TTSRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.service = Mock()
        cls.service.generate_wav.return_value = SAMPLE_WAV
        cls.inference_patcher = patch(
            "backend.app.InferenceRuntime",
            return_value=SimpleNamespace(
                architecture="test",
                idx_to_class={"A": 0},
                image_size=224,
                device="cpu",
                model=SimpleNamespace(training=False),
            ),
        )
        cls.tts_patcher = patch("backend.app.GeminiTTSService", return_value=cls.service)
        cls.inference_factory = cls.inference_patcher.start()
        cls.tts_patcher.start()
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client_context.__exit__(None, None, None)
        cls.tts_patcher.stop()
        cls.inference_patcher.stop()

    def setUp(self) -> None:
        self.service.generate_wav.reset_mock()
        self.service.generate_wav.return_value = SAMPLE_WAV
        self.service.generate_wav.side_effect = None

    def test_health_reports_loaded_model_and_device(self) -> None:
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "status": "ok",
                "model_loaded": True,
                "device": "cpu",
                "architecture": "test",
                "image_size": 224,
                "num_classes": 1,
            },
        )

    def test_returns_wav_audio_and_does_not_reload_inference(self) -> None:
        response = self.client.post("/tts", json={"text": "  Hello.  "})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "audio/wav")
        self.assertEqual(response.content, SAMPLE_WAV)
        self.service.generate_wav.assert_called_once_with("Hello.")
        self.assertEqual(self.inference_factory.call_count, 1)

    def test_rejects_empty_text(self) -> None:
        response = self.client.post("/tts", json={"text": "   "})

        self.assertEqual(response.status_code, 422)
        self.service.generate_wav.assert_not_called()

    def test_maps_missing_key_and_upstream_errors(self) -> None:
        self.service.generate_wav.side_effect = GeminiTTSNotConfiguredError()
        missing_key = self.client.post("/tts", json={"text": "Hello."})
        self.service.generate_wav.side_effect = GeminiTTSTimeoutError()
        timeout = self.client.post("/tts", json={"text": "Hello."})
        self.service.generate_wav.side_effect = GeminiTTSGenerationError(
            "Gemini TTS request failed (HTTP 404): model not found."
        )
        provider_error = self.client.post("/tts", json={"text": "Hello."})

        self.assertEqual(missing_key.status_code, 503)
        self.assertEqual(timeout.status_code, 504)
        self.assertEqual(provider_error.status_code, 502)
        self.assertEqual(
            provider_error.json()["detail"],
            "Gemini TTS request failed (HTTP 404): model not found.",
        )
        self.assertEqual(self.inference_factory.call_count, 1)

    def test_maps_authentication_quota_and_network_errors(self) -> None:
        cases = (
            (GeminiTTSAuthenticationError(), 502),
            (GeminiTTSQuotaError(), 429),
            (GeminiTTSUnavailableError(), 503),
        )
        for error, expected_status in cases:
            with self.subTest(expected_status=expected_status):
                self.service.generate_wav.side_effect = error
                response = self.client.post("/tts", json={"text": "Hello."})
                self.assertEqual(response.status_code, expected_status)
                self.assertNotIn("test-key", response.text)


if __name__ == "__main__":
    unittest.main()
