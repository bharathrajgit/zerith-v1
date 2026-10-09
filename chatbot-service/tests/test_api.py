import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.rag import DependencyUnavailable


class ChatbotApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.original_api_token = os.environ.get("CHATBOT_API_TOKEN")
        self.original_admin_token = os.environ.get("CHATBOT_ADMIN_TOKEN")
        os.environ.pop("CHATBOT_API_TOKEN", None)
        os.environ.pop("CHATBOT_ADMIN_TOKEN", None)

    def tearDown(self):
        self.client.close()
        if self.original_api_token is None:
            os.environ.pop("CHATBOT_API_TOKEN", None)
        else:
            os.environ["CHATBOT_API_TOKEN"] = self.original_api_token
        if self.original_admin_token is None:
            os.environ.pop("CHATBOT_ADMIN_TOKEN", None)
        else:
            os.environ["CHATBOT_ADMIN_TOKEN"] = self.original_admin_token

    def test_health_identifies_standalone_service(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["service"], "zerith-local-rag-chatbot")

    @patch("app.main.generate_chat_reply")
    def test_chat_returns_answer_and_retrieved_sources(self, generate_reply):
        generate_reply.return_value = {
            "reply": "What happens with an empty input?",
            "sources": [{"source": "dsa-fundamentals.md", "chunkIndex": 0, "score": 0.8}],
            "model": "qwen2.5-coder:7b",
        }

        response = self.client.post("/chat", json={
            "systemPrompt": "Socratic mentor",
            "messages": [{"role": "user", "content": "How do I test this?"}],
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["reply"], "What happens with an empty input?")
        self.assertEqual(len(response.json()["data"]["sources"]), 1)

    @patch("app.main.generate_chat_reply")
    def test_chat_reports_local_dependency_failure(self, generate_reply):
        generate_reply.side_effect = DependencyUnavailable("Ollama is unavailable")

        response = self.client.post("/chat", json={
            "systemPrompt": "Socratic mentor",
            "messages": [{"role": "user", "content": "Help me think."}],
        })

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "Ollama is unavailable")

    @patch("app.main.get_readiness")
    def test_readiness_requires_configured_service_token(self, get_readiness):
        os.environ["CHATBOT_API_TOKEN"] = "service-secret"
        get_readiness.return_value = {"ready": True}

        denied = self.client.get("/ready")
        allowed = self.client.get(
            "/ready",
            headers={"X-Chatbot-Api-Token": "service-secret"},
        )

        self.assertEqual(denied.status_code, 401)
        self.assertEqual(allowed.status_code, 200)


if __name__ == "__main__":
    unittest.main()
