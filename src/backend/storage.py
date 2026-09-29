import asyncio
import json
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from azure.cosmos import PartitionKey
from azure.cosmos.aio import CosmosClient
from azure.identity.aio import DefaultAzureCredential

from backend.models import ChatMessage, ChatSession, DocumentRecord, SessionState, utc_now_iso
from backend.settings import Settings

USER_VISIBLE_ROLES = {"user", "assistant"}


class Store(ABC):
    @abstractmethod
    async def create_session(self, session_id: str | None = None) -> ChatSession:
        raise NotImplementedError

    @abstractmethod
    async def get_session(self, session_id: str) -> ChatSession | None:
        raise NotImplementedError

    @abstractmethod
    async def list_sessions(self) -> list[ChatSession]:
        raise NotImplementedError

    @abstractmethod
    async def update_session(self, session: ChatSession) -> ChatSession:
        raise NotImplementedError

    @abstractmethod
    async def delete_session(self, session_id: str) -> bool:
        raise NotImplementedError

    @abstractmethod
    async def list_messages(self, session_id: str, *, include_hidden: bool = False) -> list[ChatMessage]:
        raise NotImplementedError

    @abstractmethod
    async def add_message(self, message: ChatMessage) -> ChatMessage:
        raise NotImplementedError

    @abstractmethod
    async def delete_messages(self, session_id: str) -> int:
        raise NotImplementedError

    async def save_messages(self, session_id: str, messages: list[ChatMessage]) -> list[ChatMessage]:
        saved: list[ChatMessage] = []
        for message in messages:
            if message.session_id != session_id:
                message = message.model_copy(update={"session_id": session_id})
            saved.append(await self.add_message(message))
        return saved

    @abstractmethod
    async def list_documents(self, session_id: str) -> list[DocumentRecord]:
        raise NotImplementedError

    @abstractmethod
    async def add_document(self, document: DocumentRecord) -> DocumentRecord:
        raise NotImplementedError

    @abstractmethod
    async def delete_document(self, session_id: str, document_id: str) -> bool:
        raise NotImplementedError

    @abstractmethod
    async def close(self) -> None:
        raise NotImplementedError


class LocalJsonStore(Store):
    def __init__(self, data_file: Path) -> None:
        self._data_file = data_file
        self._lock = asyncio.Lock()
        self._data_file.parent.mkdir(parents=True, exist_ok=True)
        if not self._data_file.exists():
            self._write({"sessions": {}, "chat_messages": {}, "documents": {}})

    async def create_session(self, session_id: str | None = None) -> ChatSession:
        session = ChatSession(id=session_id or new_session_id())
        async with self._lock:
            data = self._read()
            data["sessions"][session.session_id] = session.model_dump(by_alias=True)
            data["chat_messages"].setdefault(session.session_id, [])
            data["documents"].setdefault(session.session_id, [])
            self._write(data)
        return session

    async def get_session(self, session_id: str) -> ChatSession | None:
        async with self._lock:
            raw = self._read()["sessions"].get(session_id)
        return ChatSession.model_validate(raw) if raw else None

    async def list_sessions(self) -> list[ChatSession]:
        async with self._lock:
            rows = list(self._read()["sessions"].values())
        sessions = [ChatSession.model_validate(row) for row in rows]
        return sorted(sessions, key=lambda item: item.updated_at, reverse=True)

    async def update_session(self, session: ChatSession) -> ChatSession:
        session.updated_at = utc_now_iso()
        async with self._lock:
            data = self._read()
            data["sessions"][session.session_id] = session.model_dump(by_alias=True)
            self._write(data)
        return session

    async def delete_session(self, session_id: str) -> bool:
        async with self._lock:
            data = self._read()
            deleted = data["sessions"].pop(session_id, None) is not None
            data["chat_messages"].pop(session_id, None)
            data.get("messages", {}).pop(session_id, None)
            data["documents"].pop(session_id, None)
            self._write(data)
        return deleted

    async def list_messages(self, session_id: str, *, include_hidden: bool = False) -> list[ChatMessage]:
        async with self._lock:
            data = self._read()
            rows = list(
                data["chat_messages"].get(session_id) or data.get("messages", {}).get(session_id, [])
            )
        messages = [ChatMessage.model_validate(row) for row in rows]
        if not include_hidden:
            messages = [message for message in messages if _is_user_visible(message)]
        return sorted(messages, key=lambda message: message.created_at)

    async def add_message(self, message: ChatMessage) -> ChatMessage:
        async with self._lock:
            data = self._read()
            data["chat_messages"].setdefault(message.session_id, []).append(
                message.model_dump(by_alias=True)
            )
            session = data["sessions"].get(message.session_id)
            if session:
                session["updatedAt"] = utc_now_iso()
                if message.role == "user" and session.get("title") == "New chat":
                    session["title"] = message.text.strip()[:60] or "New chat"
            self._write(data)
        return message

    async def delete_messages(self, session_id: str) -> int:
        async with self._lock:
            data = self._read()
            rows = data["chat_messages"].get(session_id) or data.get("messages", {}).get(session_id, [])
            message_count = len(rows)
            data["chat_messages"][session_id] = []
            if "messages" in data:
                data["messages"][session_id] = []
            session = data["sessions"].get(session_id)
            if session:
                session["historyClearedAt"] = None
                session["updatedAt"] = utc_now_iso()
            self._write(data)
        return message_count

    async def list_documents(self, session_id: str) -> list[DocumentRecord]:
        async with self._lock:
            rows = list(self._read()["documents"].get(session_id, []))
        return [DocumentRecord.model_validate(row) for row in rows]

    async def add_document(self, document: DocumentRecord) -> DocumentRecord:
        async with self._lock:
            data = self._read()
            data["documents"].setdefault(document.session_id, []).append(
                document.model_dump(by_alias=True)
            )
            session = data["sessions"].get(document.session_id)
            if session:
                session["updatedAt"] = utc_now_iso()
            self._write(data)
        return document

    async def delete_document(self, session_id: str, document_id: str) -> bool:
        async with self._lock:
            data = self._read()
            docs = data["documents"].get(session_id, [])
            next_docs = [doc for doc in docs if doc.get("id") != document_id]
            data["documents"][session_id] = next_docs
            self._write(data)
        return len(next_docs) != len(docs)

    async def close(self) -> None:
        return None

    def _read(self) -> dict[str, Any]:
        data = json.loads(self._data_file.read_text(encoding="utf-8"))
        data.setdefault("sessions", {})
        data.setdefault("chat_messages", {})
        data.setdefault("documents", {})
        return data

    def _write(self, data: dict[str, Any]) -> None:
        self._data_file.write_text(json.dumps(data, indent=2), encoding="utf-8")


class CosmosStore(Store):
    def __init__(
        self,
        client: CosmosClient,
        sessions_container: Any,
        messages_container: Any,
        documents_container: Any,
        credential: DefaultAzureCredential | None = None,
    ) -> None:
        self._client = client
        self._sessions = sessions_container
        self._messages = messages_container
        self._documents = documents_container
        self._credential = credential

    @classmethod
    async def create(cls, settings: Settings) -> "CosmosStore":
        if not settings.azure_cosmos_endpoint:
            raise RuntimeError("Cosmos endpoint is not configured.")
        if not settings.cosmos_database_name:
            raise RuntimeError("Cosmos database name is not configured.")
        credential: str | DefaultAzureCredential
        managed_identity_credential: DefaultAzureCredential | None = None
        if settings.azure_cosmos_key:
            credential = settings.azure_cosmos_key
        else:
            managed_identity_credential = DefaultAzureCredential(
                managed_identity_client_id=settings.azure_client_id
            )
            credential = managed_identity_credential
        cosmos_host = urlparse(settings.azure_cosmos_endpoint).hostname
        is_local_cosmos = cosmos_host in {"127.0.0.1", "localhost"}
        connection_verify = not is_local_cosmos
        client_options = {
            "connection_verify": connection_verify,
            "enable_endpoint_discovery": not is_local_cosmos,
        }
        if is_local_cosmos:
            client_options["connection_mode"] = "Gateway"
        client = CosmosClient(
            settings.azure_cosmos_endpoint,
            credential=credential,
            **client_options,
        )
        database = await client.create_database_if_not_exists(id=settings.cosmos_database_name)
        sessions = await database.create_container_if_not_exists(
            id=settings.azure_cosmos_webchat_sessions_container_name,
            partition_key=PartitionKey(path="/sessionId"),
        )
        messages = await database.create_container_if_not_exists(
            id=settings.azure_cosmos_webchat_messages_container_name,
            partition_key=PartitionKey(path="/sessionId"),
        )
        documents = await database.create_container_if_not_exists(
            id=settings.azure_cosmos_webchat_documents_container_name,
            partition_key=PartitionKey(path="/sessionId"),
        )
        return cls(client, sessions, messages, documents, managed_identity_credential)

    async def create_session(self, session_id: str | None = None) -> ChatSession:
        session = ChatSession(id=session_id or new_session_id())
        await self._sessions.upsert_item(
            {
                **session.model_dump(by_alias=True),
                "id": f"session:{session.id}",
                "sessionId": session.session_id,
                "kind": "session",
            }
        )
        return session

    async def get_session(self, session_id: str) -> ChatSession | None:
        try:
            raw = await self._sessions.read_item(
                item=f"session:{session_id}",
                partition_key=session_id,
            )
            return ChatSession.model_validate(_strip_cosmos_fields(raw))
        except Exception:
            return None

    async def list_sessions(self) -> list[ChatSession]:
        query = 'SELECT * FROM c WHERE c.kind = "session" ORDER BY c.updatedAt DESC'
        rows = self._sessions.query_items(query=query)
        sessions = [ChatSession.model_validate(_strip_cosmos_fields(row)) async for row in rows]
        return sessions

    async def update_session(self, session: ChatSession) -> ChatSession:
        session.updated_at = utc_now_iso()
        await self._sessions.upsert_item(
            {
                **session.model_dump(by_alias=True),
                "id": f"session:{session.id}",
                "sessionId": session.session_id,
                "kind": "session",
            }
        )
        return session

    async def delete_session(self, session_id: str) -> bool:
        deleted = False
        try:
            await self._sessions.delete_item(item=f"session:{session_id}", partition_key=session_id)
            deleted = True
        except Exception:
            deleted = False
        await self.delete_messages(session_id)
        documents = await self.list_documents(session_id)
        for document in documents:
            await self.delete_document(session_id, document.id)
        return deleted

    async def list_messages(self, session_id: str, *, include_hidden: bool = False) -> list[ChatMessage]:
        query = "SELECT * FROM c WHERE c.sessionId = @sessionId ORDER BY c.createdAt"
        rows = self._messages.query_items(
            query=query,
            parameters=[{"name": "@sessionId", "value": session_id}],
            partition_key=session_id,
        )
        messages = [ChatMessage.model_validate(_strip_cosmos_fields(row)) async for row in rows]
        if not include_hidden:
            messages = [message for message in messages if _is_user_visible(message)]
        return sorted(messages, key=lambda message: message.created_at)

    async def add_message(self, message: ChatMessage) -> ChatMessage:
        await self._messages.upsert_item(
            {
                **message.model_dump(by_alias=True),
                "id": f"message:{message.id}",
                "messageId": message.id,
                "sessionId": message.session_id,
            }
        )
        session = await self.get_session(message.session_id)
        if session:
            session.updated_at = utc_now_iso()
            if message.role == "user" and session.title == "New chat":
                session.title = message.text.strip()[:60] or "New chat"
            await self.update_session(session)
        return message

    async def delete_messages(self, session_id: str) -> int:
        messages = await self.list_messages(session_id, include_hidden=True)
        for message in messages:
            await self._messages.delete_item(item=f"message:{message.id}", partition_key=session_id)
        session = await self.get_session(session_id)
        if session:
            session.history_cleared_at = None
            await self.update_session(session)
        return len(messages)

    async def list_documents(self, session_id: str) -> list[DocumentRecord]:
        query = "SELECT * FROM c WHERE c.sessionId = @sessionId ORDER BY c.createdAt"
        rows = self._documents.query_items(
            query=query,
            parameters=[{"name": "@sessionId", "value": session_id}],
            partition_key=session_id,
        )
        return [DocumentRecord.model_validate(_strip_cosmos_fields(row)) async for row in rows]

    async def add_document(self, document: DocumentRecord) -> DocumentRecord:
        await self._documents.upsert_item(
            {
                **document.model_dump(by_alias=True),
                "id": document.id,
                "sessionId": document.session_id,
            }
        )
        return document

    async def delete_document(self, session_id: str, document_id: str) -> bool:
        try:
            await self._documents.delete_item(item=document_id, partition_key=session_id)
            return True
        except Exception:
            return False

    async def close(self) -> None:
        await self._client.close()
        if self._credential is not None:
            await self._credential.close()


async def build_store(settings: Settings) -> Store:
    try:
        return await CosmosStore.create(settings)
    except Exception:
        return LocalJsonStore(settings.data_dir / "local-store.json")


class ChatSessionStore:
    def __init__(self, store: Store) -> None:
        self._store = store

    async def get_session(self, session_id: str) -> ChatSession | None:
        return await self._store.get_session(session_id)

    async def create_session(self, session: ChatSession | None = None) -> ChatSession:
        return await self._store.create_session(session.session_id if session else None)

    async def get_or_create_session(self, session_id: str) -> ChatSession:
        existing = await self.get_session(session_id)
        if existing is not None:
            return existing
        return await self._store.create_session(session_id)

    async def update_session(self, session: ChatSession) -> ChatSession:
        return await self._store.update_session(session)

    async def delete_session(self, session_id: str) -> bool:
        return await self._store.delete_session(session_id)


class ChatHistoryProvider:
    def __init__(self, store: Store) -> None:
        self._store = store

    async def get_messages(
        self,
        session_id: str,
        state: ChatSession | None = None,
        *,
        include_hidden: bool = False,
    ) -> list[ChatMessage]:
        messages = await self._store.list_messages(session_id, include_hidden=include_hidden)
        cleared_at = state.history_cleared_at if state else None
        if cleared_at:
            messages = [message for message in messages if _is_after(message.created_at, cleared_at)]
        if not include_hidden:
            messages = [message for message in messages if _is_user_visible(message)]
        return sorted(messages, key=lambda message: message.created_at)

    async def save_messages(
        self,
        session_id: str,
        messages: list[ChatMessage],
        state: ChatSession | None = None,
    ) -> list[ChatMessage]:
        del state
        return await self._store.save_messages(
            session_id,
            [_redact_for_history(message) for message in messages],
        )

    async def count_messages(self, session_id: str, since: str | None = None) -> int:
        messages = await self._store.list_messages(session_id, include_hidden=True)
        if since:
            messages = [message for message in messages if _is_after(message.created_at, since)]
        return len(messages)


def build_session_state(
    session: ChatSession,
    messages: list[ChatMessage],
    documents: list[DocumentRecord],
) -> SessionState:
    return SessionState(session=session, messages=messages, documents=documents)


def new_session_id() -> str:
    from backend.models import new_id

    return new_id()


def _is_user_visible(message: ChatMessage) -> bool:
    return message.role in USER_VISIBLE_ROLES and bool(message.text.strip())


def _is_after(value: str, floor: str) -> bool:
    try:
        return datetime.fromisoformat(value) > datetime.fromisoformat(floor)
    except ValueError:
        return value > floor


def _redact_for_history(message: ChatMessage) -> ChatMessage:
    if message.role not in {"tool", "internal"}:
        return message
    text = message.text.strip()
    if len(text) > 240:
        text = text[:237] + "..."
    return message.model_copy(update={"text": text or "[redacted internal output]", "contents": []})


def _strip_cosmos_fields(row: dict[str, Any]) -> dict[str, Any]:
    ignored = {"_rid", "_self", "_etag", "_attachments", "_ts", "kind", "messageId"}
    next_row = {key: value for key, value in row.items() if key not in ignored}
    if str(row.get("id", "")).startswith("message:"):
        next_row["id"] = row.get("messageId") or row["id"].replace("message:", "", 1)
    if str(row.get("id", "")).startswith("session:"):
        next_row["id"] = row["id"].replace("session:", "", 1)
    return next_row
