from azure.identity.aio import DefaultAzureCredential, get_bearer_token_provider
from openai import AsyncAzureOpenAI, AsyncOpenAI
import logging
from collections.abc import Callable
from typing import Any

from backend.models import ChatMessage, DocumentRecord, SourceCitation
from backend.settings import Settings

logger = logging.getLogger(__name__)

TokenUsage = dict[str, int | bool]

SYSTEM_PROMPT = """You are a generic web chat assistant.
Use uploaded document excerpts when they are relevant. Be direct and cite uploaded
filenames in plain text when you rely on them. If documents do not contain enough
information, say what is missing and ask for the needed detail."""


class ChatService:
    def __init__(self, settings: Settings, settings_factory: Callable[[], Settings] | None = None) -> None:
        self._settings = settings
        self._settings_factory = settings_factory
        self._credential: DefaultAzureCredential | None = None
        self._client: Any = None
        self.startup_error: str | None = None

    @property
    def is_configured(self) -> bool:
        return bool(self._settings.openai_endpoint and self._settings.openai_deployment)

    @property
    def is_ready(self) -> bool:
        return self._client is not None and self.startup_error is None

    async def start(self, *, refresh_settings: bool = False) -> None:
        if refresh_settings and self._settings_factory is not None:
            self._settings = self._settings_factory()
        await self._close_client()
        endpoint = self._settings.openai_endpoint
        deployment = self._settings.openai_deployment
        if not endpoint or not deployment:
            self.startup_error = "Azure OpenAI endpoint or deployment is not configured."
            return
        api_key = self._settings.openai_api_key
        if api_key:
            if _is_openai_v1_endpoint(endpoint):
                self._client = AsyncOpenAI(base_url=endpoint.rstrip("/"), api_key=api_key)
            else:
                self._client = AsyncAzureOpenAI(
                    azure_endpoint=endpoint,
                    api_key=api_key,
                    api_version=self._settings.openai_api_version,
                )
            self.startup_error = None
            return
        self._credential = DefaultAzureCredential(
            managed_identity_client_id=self._settings.azure_client_id
        )
        token_provider = get_bearer_token_provider(
            self._credential,
            "https://cognitiveservices.azure.com/.default",
        )
        self._client = AsyncAzureOpenAI(
            azure_endpoint=endpoint,
            azure_ad_token_provider=token_provider,
            api_version=self._settings.openai_api_version,
        )
        self.startup_error = None

    async def close(self) -> None:
        await self._close_client()

    async def _close_client(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None
        if self._credential is not None:
            await self._credential.close()
            self._credential = None

    async def reply(
        self,
        *,
        session_id: str,
        user_content: str,
        messages: list[ChatMessage],
        documents: list[DocumentRecord],
    ) -> ChatMessage:
        metadata: dict[str, Any] = {}
        if self._client is None or not self._settings.openai_deployment:
            content = self._fallback_reply(user_content, documents)
        else:
            try:
                content, token_usage = await self._openai_reply(user_content, messages, documents)
                if token_usage:
                    metadata["tokenUsage"] = token_usage
                self.startup_error = None
            except Exception as exc:
                self.startup_error = _short_error(exc)
                logger.warning("Azure OpenAI chat request failed; using local fallback.", exc_info=True)
                content, token_usage = await self._retry_openai_reply(user_content, messages, documents)
                if token_usage:
                    metadata["tokenUsage"] = token_usage
        citations = _document_citations(documents)
        return ChatMessage(session_id=session_id, role="assistant", text=content, metadata=metadata, citations=citations)

    async def _retry_openai_reply(
        self,
        user_content: str,
        messages: list[ChatMessage],
        documents: list[DocumentRecord],
    ) -> tuple[str, TokenUsage | None]:
        if self._settings_factory is None:
            return self._fallback_reply(user_content, documents), None
        try:
            await self.start(refresh_settings=True)
            if self._client is None or not self._settings.openai_deployment:
                return self._fallback_reply(user_content, documents), None
            content, token_usage = await self._openai_reply(user_content, messages, documents)
            self.startup_error = None
            return content, token_usage
        except Exception as exc:
            self.startup_error = _short_error(exc)
            logger.warning("Azure OpenAI chat retry failed; using local fallback.", exc_info=True)
            return self._fallback_reply(user_content, documents), None

    async def _openai_reply(
        self,
        user_content: str,
        messages: list[ChatMessage],
        documents: list[DocumentRecord],
    ) -> tuple[str, TokenUsage | None]:
        document_context = _build_document_context(documents)
        conversation = [{"role": "system", "content": SYSTEM_PROMPT}]
        if document_context:
            conversation.append(
                {
                    "role": "system",
                    "content": f"Uploaded document context:\n{document_context}",
                }
            )
        for message in messages[-16:]:
            if message.role in {"user", "assistant"}:
                conversation.append({"role": message.role, "content": message.text})
        conversation.append({"role": "user", "content": user_content})
        response = await self._client.chat.completions.create(
            model=self._settings.openai_deployment,
            messages=conversation,
            temperature=0.2,
        )
        return response.choices[0].message.content or "", _token_usage(response)

    def _fallback_reply(self, user_content: str, documents: list[DocumentRecord]) -> str:
        reason = self.startup_error or "Azure OpenAI is not ready for this backend process."
        if documents:
            lines = [
                f"{reason} I am using local document analysis.",
                "",
                "Uploaded document summary:",
            ]
            for document in documents:
                lines.append(f"- {document.filename}: {document.summary or 'No extractable text found.'}")
            lines.extend(
                [
                    "",
                    f"Your request: {user_content}",
                    "Check `/api/health` and the backend logs for Azure OpenAI readiness.",
                ]
            )
            return "\n".join(lines)
        return (
            f"{reason} "
            "Upload a document for local extraction, or check Azure OpenAI settings in `.azure/local/.env` "
            "for full chat responses."
        )


def _build_document_context(documents: list[DocumentRecord], max_chars: int = 18000) -> str:
    parts: list[str] = []
    remaining = max_chars
    for document in documents:
        text = document.text.strip()
        snippet = text[: min(5000, remaining)]
        if not snippet:
            continue
        citation = _document_citation(document, len(snippet))
        location = _citation_label(citation)
        block = f"[{location}]\n{snippet}"
        parts.append(block)
        remaining -= len(block)
        if remaining <= 0:
            break
    return "\n\n".join(parts)


def _document_citations(documents: list[DocumentRecord], max_chars: int = 18000) -> list[SourceCitation]:
    citations: list[SourceCitation] = []
    remaining = max_chars
    for document in documents:
        text = document.text.strip()
        if not document.filename or not text:
            continue
        snippet_length = min(5000, remaining, len(text))
        citations.append(_document_citation(document, snippet_length))
        remaining -= snippet_length
        if remaining <= 0:
            break
    return citations


def _document_citation(document: DocumentRecord, max_chars: int) -> SourceCitation:
    snippet = document.text.strip()[:max_chars]
    line_count = max(1, len(snippet.splitlines()))
    return SourceCitation(filename=document.filename, line_start=1, line_end=line_count)


def _citation_label(citation: SourceCitation) -> str:
    if citation.line_start and citation.line_end:
        if citation.line_start == citation.line_end:
            return f"{citation.filename} line {citation.line_start}"
        return f"{citation.filename} lines {citation.line_start}-{citation.line_end}"
    return citation.filename


def _is_openai_v1_endpoint(endpoint: str) -> bool:
    return endpoint.rstrip("/").endswith("/openai/v1")


def _token_usage(response: Any) -> TokenUsage | None:
    usage = getattr(response, "usage", None)
    if usage is None:
        return None
    token_usage: TokenUsage = {}
    for response_key, metadata_key in (
        ("prompt_tokens", "promptTokens"),
        ("completion_tokens", "completionTokens"),
        ("total_tokens", "totalTokens"),
    ):
        value = getattr(usage, response_key, None)
        if isinstance(value, int):
            token_usage[metadata_key] = value
    return token_usage or None


def _short_error(exc: Exception) -> str:
    message = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    if "invalid subscription key or wrong api endpoint" in message.lower():
        return (
            "Azure OpenAI authentication failed. Verify the endpoint, deployment, "
            "and API key or Azure credential in `.azure/local/.env`."
        )
    if len(message) > 240:
        message = message[:237] + "..."
    return f"{type(exc).__name__}: {message}" if message else type(exc).__name__
