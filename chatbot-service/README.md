# Zerith local RAG chatbot service

This is a standalone process; it does not run inside the Express API or the
proctoring ML service. The Express chatbot can call it over HTTP while the
service can be started, inspected, restarted, and debugged independently.

## Components

- Ollama serves the local chat model and embedding model.
- Qdrant stores persistent document vectors and metadata. The default is
  embedded local storage, so the service has no database server dependency.
- This FastAPI service retrieves relevant chunks and sends them with the
  Socratic system prompt to Ollama.
- `rag_local_chatbot.ipynb` is an interactive setup, indexing, retrieval, and
  answer-debugging client. The service remains the always-on runtime.

## One-time setup on Windows

1. Install and start [Ollama](https://ollama.com/download). Pull the embedding
   model if it is not already installed:

   ```powershell
   ollama pull nomic-embed-text
   ```

   The `groq-rag` integration uses Groq for text generation, so it does not
   require an Ollama chat model. The standalone service's `/chat` endpoint can
   use Ollama directly; for that mode, pull the configured `OLLAMA_CHAT_MODEL`
   or set it to another installed model. `OLLAMA_KEEP_ALIVE` defaults to `30m`.

2. The default embedded Qdrant mode needs no separate process and persists
   vectors in `chatbot-service/qdrant-storage`. For multi-worker or multi-host
   deployments, start a Qdrant server with Docker Compose:

   ```powershell
   docker compose up -d qdrant
   ```

   For managed Qdrant, set `QDRANT_URL` and `QDRANT_API_KEY` instead.

3. Create a dedicated Python environment and install this service's
   dependencies:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

4. Add learning notes (`.md`, `.txt`, or `.jsonl`) under `rag-corpus`. Avoid
   secrets and student data. Index them by running the service and then using
   the notebook's indexing cell or `POST /admin/index`.

## Run and debug independently

Run `run_chatbot_service.bat` from a dedicated terminal for a stable process
on `127.0.0.1:8100`. Use `debug_chatbot_service.bat` during development for
auto-reload and debug logging. Both run independently of Express. Keep the
stable process terminal open for continuous availability; restarting the
Express API does not restart this process. To keep it running after sign-in,
add the stable batch file to Windows Task Scheduler for your user session.

- `GET http://127.0.0.1:8100/health` checks that the API process responds.
- `GET http://127.0.0.1:8100/ready` reports model availability, Qdrant
  connectivity, and index state.
- `POST http://127.0.0.1:8100/debug/retrieve` tests retrieval without asking
  the LLM to answer.
- `POST http://127.0.0.1:8100/admin/index` indexes the configured corpus.
- `http://127.0.0.1:8100/docs` provides interactive API debugging.

The service binds to loopback by default. Do not bind it to a public interface
without setting `CHATBOT_ADMIN_TOKEN`, authenticating the chat endpoint, and
placing it behind an appropriately secured gateway. Embedded Qdrant mode is
single-process; use a Qdrant server for multiple workers. A managed Qdrant
instance does not make the Ollama model itself remotely available; Ollama must
run on the service host or be reachable over a private network.

## Connect the existing chatbot

In `server/.env`, select local retrieval with Groq generation:

```dotenv
CHAT_PROVIDER=groq-rag
CHATBOT_SERVICE_URL=http://127.0.0.1:8100
CHATBOT_TIMEOUT_MS=120000
```

`groq-rag` retrieves relevant chunks from the local service, adds them to the
Socratic system context, and generates the answer with the existing
`GROQ_API_KEY` and `GROQ_MODEL` from `server/.env`. The key stays in the
Express process and is never sent to the RAG service. Restart Express after
changing its environment. Use `CHAT_PROVIDER=local-rag` only when you want
Ollama to generate answers locally. The authenticated
`GET /api/chat/service-health` endpoint reports retrieval readiness and
whether Groq is configured. Provider failures are reported rather than
silently returning an ungrounded or canned answer.

## Configuration and scaling

Copy `.env.example` to `.env` and configure the service before starting it.
Embedded Qdrant is intended for a single local worker. Switch to a persistent
Qdrant server and secured private network when the corpus or number of API
workers grows; avoid running corpus re-indexing concurrently from multiple
workers. Ollama concurrency and model choice should be load-tested on the
target GPU before adding workers.

If you bind the service beyond loopback, set `CHATBOT_API_TOKEN` and configure
the same value in the Express API. Protect the indexing operation separately
with `CHATBOT_ADMIN_TOKEN`; keep both tokens private and use TLS at the gateway.

The code supports markdown, text, and JSON Lines sources. It uses deterministic
point IDs, batches embedding requests, updates changed chunks, and removes
stale indexed chunks when re-indexing the corpus.
