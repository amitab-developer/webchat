# Templateon Web Chat

Standalone generic chat app with a FastAPI backend, React frontend, document upload, document-grounded analysis, optional Azure OpenAI, and optional Cosmos DB persistence.

## Run Locally

```powershell
uv sync
cd src/frontend
npm install
```

Start the backend with `PYTHONPATH=src uv run uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000` and the frontend with `npm run dev` from `src/frontend`.

Open `http://127.0.0.1:5173`.

The backend reads `.azure/local/.env`. If Azure OpenAI variables are present, chat responses use the configured deployment. If Cosmos variables are present and reachable, sessions/messages/files are persisted in Cosmos; otherwise the app falls back to `data/local-store.json`.

Use `.azure/.env.example` as the sanitized template. Real `.env` files are ignored by git.

## VS Code Workflows

Use **Run and Debug** to start the `WebChat : Backend + Frontend` compound profile. Its preflight step restores the Python environment with `uv sync` and frontend dependencies with `npm install` when they are missing or incomplete. It also verifies Docker and starts the Cosmos emulator when needed.

Use `Workspace : Clean` to remove downloaded environments, modules, and development caches:

- `.venv/`
- `src/frontend/node_modules/`
- `__pycache__/`, `.pytest_cache/`, `.ruff_cache/`, `.mypy_cache/`, and `.npm-cache/`

The clean profile does not remove application code, Git metadata, `.azure/local/.env`, or `data/`.

## Layout

```text
src/backend/  FastAPI API, document extraction, chat service, persistence.
src/frontend/ Vite React chat client.
tests/        Backend smoke tests.
data/         Local runtime uploads, logs, and JSON fallback storage.
```

## Useful Env Vars

- `AZURE_FOUNDRY_API_ENDPOINT` or `AZURE_OPENAI_ENDPOINT`
- `AZURE_FOUNDRY_RUNTIME_API_VERSION` or `AZURE_OPENAI_API_VERSION`
- `AZURE_FOUNDRY_CHAT_MODEL_DEPLOYMENT` or `AZURE_OPENAI_CHAT_DEPLOYMENT`
- `AZURE_FOUNDRY_API_KEY` or `AZURE_OPENAI_API_KEY` optional; when absent the backend tries `DefaultAzureCredential`
- `AZURE_COSMOS_ENDPOINT`
- `AZURE_COSMOS_KEY`
- `AZURE_COSMOS_WEBCHAT_DATABASE_NAME` optional
- `AZURE_COSMOS_WEBCHAT_SESSIONS_CONTAINER_NAME` optional
- `AZURE_COSMOS_WEBCHAT_MESSAGES_CONTAINER_NAME` optional
- `AZURE_COSMOS_WEBCHAT_DOCUMENTS_CONTAINER_NAME` optional
