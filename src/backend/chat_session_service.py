from backend.chat_service import ChatService
from backend.models import (
    ChatMessage,
    ChatSession,
    ClearHistoryResponse,
    DeleteSessionResponse,
    MessagesResponse,
    SendMessageResponse,
    SessionState,
    utc_now_iso,
)
from backend.storage import ChatHistoryProvider, ChatSessionStore, Store, build_session_state


class SessionNotFoundError(Exception):
    def __init__(self, session_id: str) -> None:
        super().__init__(f"Session not found: {session_id}")
        self.session_id = session_id


class ChatSessionService:
    def __init__(self, store: Store, chat_service: ChatService) -> None:
        self._store = store
        self._chat = chat_service
        self.sessions = ChatSessionStore(store)
        self.history = ChatHistoryProvider(store)

    async def create_session(self) -> ChatSession:
        return await self.sessions.create_session()

    async def list_sessions(self) -> list[ChatSession]:
        return await self._store.list_sessions()

    async def get_session_state(self, session_id: str) -> SessionState:
        session = await self.sessions.get_session(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        messages = await self.history.get_messages(session_id, session)
        documents = await self._store.list_documents(session_id)
        return build_session_state(session, messages, documents)

    async def list_messages(self, session_id: str) -> MessagesResponse:
        session = await self.sessions.get_session(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        messages = await self.history.get_messages(session_id, session)
        return MessagesResponse(session_id=session_id, messages=messages)

    async def update_session_title(self, session_id: str, title: str) -> ChatSession:
        session = await self.sessions.get_session(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        session.title = _clean_title(title)
        return await self.sessions.update_session(session)

    async def send_message(self, session_id: str, content: str) -> SendMessageResponse:
        session = await self.sessions.get_or_create_session(session_id)
        prior_messages = await self.history.get_messages(session_id, session)
        documents = await self._store.list_documents(session_id)

        user_message = ChatMessage(session_id=session_id, role="user", text=content)
        await self.history.save_messages(session_id, [user_message], session)

        assistant_message = await self._chat.reply(
            session_id=session_id,
            user_content=content,
            messages=prior_messages,
            documents=documents,
        )
        await self.history.save_messages(session_id, [assistant_message], session)

        updated_session = await self.sessions.get_session(session_id)
        if updated_session is not None:
            updated_session.state = session.state
            await self.sessions.update_session(updated_session)

        return SendMessageResponse(
            session=updated_session or session,
            user_message=user_message,
            assistant_message=assistant_message,
            citations=assistant_message.citations,
            actions=list(assistant_message.metadata.get("actions", [])),
        )

    async def clear_history(self, session_id: str) -> ClearHistoryResponse:
        session = await self.sessions.get_or_create_session(session_id)
        visible_messages = await self.history.get_messages(session_id, session)
        cleared_at = utc_now_iso()
        await self._store.delete_messages(session_id)
        return ClearHistoryResponse(
            session_id=session_id,
            cleared_at=cleared_at,
            message_count=len(visible_messages),
        )

    async def delete_session(self, session_id: str) -> DeleteSessionResponse:
        deleted = await self.sessions.delete_session(session_id)
        if not deleted:
            raise SessionNotFoundError(session_id)
        return DeleteSessionResponse(session_id=session_id, deleted=True)


def _clean_title(title: str) -> str:
    normalized = " ".join(title.strip().split())
    return normalized[:80] or "New chat"