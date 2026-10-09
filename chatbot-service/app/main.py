import logging
import os
import hmac
from typing import List, Literal, Optional

from fastapi import FastAPI, Header, HTTPException
from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

from app.rag import (
    DependencyUnavailable,
    generate_chat_reply,
    get_readiness,
    index_corpus,
    retrieve_chunks,
    verify_admin_token,
)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("zerith.chatbot")
app = FastAPI(
    title="Zerith Local RAG Chatbot",
    version="1.0.0",
    description="Standalone local Ollama + Qdrant RAG service.",
)


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=12000)


class ChatRequest(BaseModel):
    systemPrompt: str = Field(min_length=1, max_length=16000)
    messages: List[ChatTurn] = Field(min_length=1, max_length=12)
    topK: int = Field(default=4, ge=1, le=10)


class RetrieveRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    topK: int = Field(default=4, ge=1, le=10)


def _require_admin(provided_token: Optional[str]) -> None:
    if not verify_admin_token(provided_token or ""):
        raise HTTPException(status_code=401, detail="Invalid chatbot admin token")


def _require_api_token(provided_token: Optional[str]) -> None:
    expected_token = os.getenv("CHATBOT_API_TOKEN", "")
    if expected_token and not hmac.compare_digest(provided_token or "", expected_token):
        raise HTTPException(status_code=401, detail="Invalid chatbot API token")


@app.get("/health")
def health():
    return {"success": True, "service": "zerith-local-rag-chatbot"}


@app.get("/ready")
def ready(x_chatbot_api_token: Optional[str] = Header(default=None)):
    _require_api_token(x_chatbot_api_token)
    result = get_readiness()
    if not result["ready"]:
        raise HTTPException(status_code=503, detail=result)
    return {"success": True, "data": result}


@app.post("/chat")
def chat(
    request: ChatRequest,
    x_chatbot_api_token: Optional[str] = Header(default=None),
):
    _require_api_token(x_chatbot_api_token)
    try:
        result = generate_chat_reply(
            request.systemPrompt,
            [message.dict() for message in request.messages],
            request.topK,
        )
    except (DependencyUnavailable, ValueError) as error:
        logger.warning("Chat request unavailable: %s", error)
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        logger.exception("Unexpected local chat failure")
        raise HTTPException(
            status_code=500,
            detail="Local chat failed: {}".format(error),
        ) from error

    return {"success": True, "data": result}


@app.post("/debug/retrieve")
def debug_retrieve(
    request: RetrieveRequest,
    x_chatbot_api_token: Optional[str] = Header(default=None),
):
    _require_api_token(x_chatbot_api_token)
    try:
        results = retrieve_chunks(request.query, request.topK)
    except (DependencyUnavailable, ValueError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        logger.exception("RAG retrieval failed")
        raise HTTPException(
            status_code=500,
            detail="RAG retrieval failed: {}".format(error),
        ) from error
    return {"success": True, "data": {"results": results}}


@app.post("/admin/index")
def index(
    x_chatbot_api_token: Optional[str] = Header(default=None),
    x_chatbot_admin_token: Optional[str] = Header(default=None),
):
    _require_api_token(x_chatbot_api_token)
    _require_admin(x_chatbot_admin_token)
    try:
        result = index_corpus()
    except (DependencyUnavailable, FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        logger.exception("Corpus indexing failed")
        raise HTTPException(
            status_code=500,
            detail="Corpus indexing failed: {}".format(error),
        ) from error
    return {"success": True, "data": result}
