from contextlib import asynccontextmanager
import logging
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.chat_service import ChatService
from backend.chat_session_service import ChatSessionService, SessionNotFoundError
from backend.document_processing import extract_text, summarize_text
from backend.models import (
    ChatSession,
    ClearHistoryResponse,
    CreateSessionResponse,
    DeleteSessionResponse,
    DocumentRecord,
    MessagesResponse,
    SendMessageRequest,
    SendMessageResponse,
    SessionState,
    UpdateSessionTitleRequest,
)
from backend.settings import ROOT_DIR, Settings, get_settings, reload_settings
from backend.storage import Store, build_store

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    store = await build_store(settings)
    chat_service = ChatService(settings, settings_factory=reload_settings)
    try:
        await chat_service.start()
    except Exception as exc:
        chat_service.startup_error = f"{type(exc).__name__}: {exc}"
        logger.warning("Azure OpenAI chat service did not start.", exc_info=True)
    app.state.settings = settings
    app.state.store = store
    app.state.chat_service = chat_service
    app.state.chat_session_service = ChatSessionService(store, chat_service)
    try:
        yield
    finally:
        await chat_service.close()
        await store.close()


app = FastAPI(title="Templateon Web Chat", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health(request: Request) -> dict[str, object]:
    settings = _settings(request)
    return {
        "ok": True,
        "openaiConfigured": _chat(request).is_configured,
        "openaiReady": _chat(request).is_ready,
        "openaiStartupError": _chat(request).startup_error,
        "cosmosConfigured": bool(
            settings.azure_cosmos_endpoint
            and (settings.azure_cosmos_key or settings.azure_client_id)
        ),
    }


@app.post("/api/sessions", response_model=CreateSessionResponse)
async def create_session(request: Request) -> CreateSessionResponse:
    session = await _sessions(request).create_session()
    return CreateSessionResponse(session=session)


@app.get("/api/sessions", response_model=list[ChatSession])
async def list_sessions(request: Request) -> list[ChatSession]:
    return await _sessions(request).list_sessions()


@app.get("/api/sessions/{session_id}", response_model=SessionState)
async def get_session(session_id: str, request: Request) -> SessionState:
    try:
        return await _sessions(request).get_session_state(session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Session not found.") from exc


@app.patch("/api/sessions/{session_id}/title", response_model=ChatSession)
async def update_session_title(
    session_id: str,
    payload: UpdateSessionTitleRequest,
    request: Request,
) -> ChatSession:
    try:
        return await _sessions(request).update_session_title(session_id, payload.title)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Session not found.") from exc


@app.get("/api/sessions/{session_id}/messages", response_model=MessagesResponse)
async def list_messages(session_id: str, request: Request) -> MessagesResponse:
    try:
        return await _sessions(request).list_messages(session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Session not found.") from exc


@app.post("/api/sessions/{session_id}/messages", response_model=SendMessageResponse)
async def send_message(
    session_id: str,
    payload: SendMessageRequest,
    request: Request,
) -> SendMessageResponse:
    settings = _settings(request)
    content = payload.content.strip()
    if len(content) > settings.chat_max_message_length:
        raise HTTPException(status_code=413, detail="Message is too long.")
    return await _sessions(request).send_message(session_id, content)


@app.delete("/api/sessions/{session_id}/history", response_model=ClearHistoryResponse)
async def clear_history(session_id: str, request: Request) -> ClearHistoryResponse:
    return await _sessions(request).clear_history(session_id)


@app.delete("/api/sessions/{session_id}", response_model=DeleteSessionResponse)
async def delete_session(session_id: str, request: Request) -> DeleteSessionResponse:
    try:
        return await _sessions(request).delete_session(session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Session not found.") from exc


@app.post("/api/sessions/{session_id}/documents", response_model=list[DocumentRecord])
async def upload_documents(
    session_id: str,
    request: Request,
    files: list[UploadFile] = File(...),
) -> list[DocumentRecord]:
    settings = _settings(request)
    await _require_session(request, session_id)
    current_documents = await _store(request).list_documents(session_id)
    if len(current_documents) + len(files) > settings.session_upload_max_file_count:
        raise HTTPException(status_code=400, detail="Too many uploaded files for this session.")

    saved_documents: list[DocumentRecord] = []
    for upload in files:
        filename = Path(upload.filename or "upload.bin").name
        suffix = Path(filename).suffix.lower()
        if suffix not in settings.supported_extensions:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {filename}")
        data = await upload.read()
        if not data:
            raise HTTPException(status_code=400, detail=f"File is empty: {filename}")
        if len(data) > settings.session_upload_max_file_size_bytes:
            raise HTTPException(status_code=413, detail=f"File is too large: {filename}")
        upload_path = settings.data_dir / "uploads" / session_id / f"{uuid4().hex}{suffix}"
        upload_path.parent.mkdir(parents=True, exist_ok=True)
        upload_path.write_bytes(data)
        try:
            text = extract_text(upload_path, upload.content_type)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not extract text from {filename}") from exc
        if not text.strip():
            raise HTTPException(
                status_code=400,
                detail=f"No extractable text found in {filename}",
            )
        document = DocumentRecord(
            session_id=session_id,
            filename=filename,
            content_type=upload.content_type,
            size=len(data),
            text=text,
            summary=summarize_text(text),
        )
        saved_documents.append(await _store(request).add_document(document))
    return saved_documents


@app.get("/api/sessions/{session_id}/documents", response_model=list[DocumentRecord])
async def list_documents(session_id: str, request: Request) -> list[DocumentRecord]:
    await _require_session(request, session_id)
    return await _store(request).list_documents(session_id)


@app.delete("/api/sessions/{session_id}/documents/{document_id}")
async def delete_document(session_id: str, document_id: str, request: Request) -> dict[str, bool]:
    await _require_session(request, session_id)
    deleted = await _store(request).delete_document(session_id, document_id)
    return {"deleted": deleted}


dist_dir = ROOT_DIR / "src" / "frontend" / "dist"
if dist_dir.exists():
    assets_dir = dist_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa_fallback(path: str) -> FileResponse:
        requested = dist_dir / path
        if requested.is_file():
            return FileResponse(requested)
        return FileResponse(dist_dir / "index.html")


async def _require_session(request: Request, session_id: str):
    session = await _store(request).get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found.")
    return session


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _store(request: Request) -> Store:
    return request.app.state.store


def _chat(request: Request) -> ChatService:
    return request.app.state.chat_service


def _sessions(request: Request) -> ChatSessionService:
    return request.app.state.chat_session_service
