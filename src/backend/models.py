from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def new_id() -> str:
    return uuid4().hex


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class ChatSession(ApiModel):
    id: str = Field(default_factory=new_id)
    session_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("sessionId", "session_id"),
        serialization_alias="sessionId",
    )
    title: str = "New chat"
    state: dict[str, Any] = Field(default_factory=dict)
    history_cleared_at: str | None = Field(
        default=None,
        validation_alias=AliasChoices("historyClearedAt", "history_cleared_at"),
        serialization_alias="historyClearedAt",
    )
    created_at: str = Field(
        default_factory=utc_now_iso,
        validation_alias=AliasChoices("createdAt", "created_at"),
        serialization_alias="createdAt",
    )
    updated_at: str = Field(
        default_factory=utc_now_iso,
        validation_alias=AliasChoices("updatedAt", "updated_at"),
        serialization_alias="updatedAt",
    )

    @model_validator(mode="after")
    def default_session_id(self) -> "ChatSession":
        if self.session_id is None:
            self.session_id = self.id
        return self


class ChatMessage(ApiModel):
    id: str = Field(default_factory=new_id)
    session_id: str = Field(
        validation_alias=AliasChoices("sessionId", "session_id"),
        serialization_alias="sessionId",
    )
    role: Literal["user", "assistant", "system", "tool", "internal"]
    text: str = Field(default="", validation_alias=AliasChoices("text", "content"))
    contents: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias=AliasChoices("metadata", "additionalProperties"),
    )
    created_at: str = Field(
        default_factory=utc_now_iso,
        validation_alias=AliasChoices("createdAt", "created_at"),
        serialization_alias="createdAt",
    )
    citations: list["SourceCitation"] = Field(default_factory=list)

    @field_validator("citations", mode="before")
    @classmethod
    def normalize_citations(cls, value: Any) -> Any:
        if not isinstance(value, list):
            return value
        return [
            {"filename": item} if isinstance(item, str) else item
            for item in value
        ]

    @property
    def content(self) -> str:
        return self.text


class DocumentRecord(ApiModel):
    id: str = Field(default_factory=new_id)
    session_id: str = Field(
        validation_alias=AliasChoices("sessionId", "session_id"),
        serialization_alias="sessionId",
    )
    filename: str
    content_type: str | None = Field(
        default=None,
        validation_alias=AliasChoices("contentType", "content_type"),
        serialization_alias="contentType",
    )
    size: int = 0
    text: str = ""
    summary: str = ""
    created_at: str = Field(
        default_factory=utc_now_iso,
        validation_alias=AliasChoices("createdAt", "created_at"),
        serialization_alias="createdAt",
    )


class SourceCitation(ApiModel):
    filename: str
    line_start: int | None = Field(
        default=None,
        validation_alias=AliasChoices("lineStart", "line_start"),
        serialization_alias="lineStart",
    )
    line_end: int | None = Field(
        default=None,
        validation_alias=AliasChoices("lineEnd", "line_end"),
        serialization_alias="lineEnd",
    )


class CreateSessionResponse(ApiModel):
    session: ChatSession


class SendMessageRequest(ApiModel):
    content: str = Field(min_length=1)


class UpdateSessionTitleRequest(ApiModel):
    title: str = Field(min_length=1, max_length=80)


class MessagesResponse(ApiModel):
    session_id: str = Field(serialization_alias="sessionId")
    messages: list[ChatMessage] = Field(default_factory=list)


class SendMessageResponse(ApiModel):
    session: ChatSession
    user_message: ChatMessage = Field(serialization_alias="userMessage")
    assistant_message: ChatMessage = Field(serialization_alias="assistantMessage")
    citations: list[SourceCitation] = Field(default_factory=list)
    actions: list[dict[str, Any]] = Field(default_factory=list)


class ClearHistoryResponse(ApiModel):
    session_id: str = Field(serialization_alias="sessionId")
    cleared_at: str = Field(serialization_alias="clearedAt")
    message_count: int = Field(serialization_alias="messageCount")


class DeleteSessionResponse(ApiModel):
    session_id: str = Field(serialization_alias="sessionId")
    deleted: bool


class SessionState(ApiModel):
    session: ChatSession
    messages: list[ChatMessage] = Field(default_factory=list)
    documents: list[DocumentRecord] = Field(default_factory=list)

