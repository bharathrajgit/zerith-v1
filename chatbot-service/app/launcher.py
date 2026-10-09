import os
from pathlib import Path

from dotenv import load_dotenv
import uvicorn


SERVICE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(SERVICE_DIR / ".env")

uvicorn.run(
    "app.main:app",
    host=os.getenv("CHATBOT_HOST", "127.0.0.1"),
    port=int(os.getenv("CHATBOT_PORT", "8100")),
    reload=os.getenv("CHATBOT_RELOAD", "false").lower() == "true",
    log_level=os.getenv("CHATBOT_LOG_LEVEL", "info"),
)
