from functools import lru_cache
import json
import os
from pathlib import Path

from dotenv import dotenv_values
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[2]
ENV_FILES = (ROOT_DIR / ".azure" / "local" / ".env",)


def _clear_stale_api_keys(file_keys: set[str], loaded_from_file: set[str]) -> None:
    groups = (
        (
            "AZURE_FOUNDRY_API_KEY",
            {
                "AZURE_FOUNDRY_API_ENDPOINT",
                "AZURE_FOUNDRY_RUNTIME_API_VERSION",
                "AZURE_FOUNDRY_CHAT_MODEL_DEPLOYMENT",
            },
        ),
        (
            "AZURE_OPENAI_API_KEY",
            {
                "AZURE_OPENAI_ENDPOINT",
                "AZURE_OPENAI_API_VERSION",
                "AZURE_OPENAI_CHAT_DEPLOYMENT",
            },
        ),
    )
    for api_key, config_keys in groups:
        if (
            config_keys.isdisjoint(file_keys)
            or api_key in file_keys
            or api_key not in loaded_from_file
        ):
            continue
        os.environ.pop(api_key, None)
        loaded_from_file.remove(api_key)


def load_environment(*, override: bool = False) -> None:
    loaded_from_file: set[str] = set()
    for env_file in ENV_FILES:
        values = dotenv_values(env_file)
        _clear_stale_api_keys(set(values.keys()), loaded_from_file)
        for key, value in values.items():
            if value is None:
                continue
            if override or key not in os.environ or key in loaded_from_file:
                os.environ[key] = value
                loaded_from_file.add(key)


load_environment()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    app_name: str = "Templateon Web Chat"
    data_dir: Path = ROOT_DIR / "data"

    azure_foundry_api_endpoint: str | None = None
    azure_openai_endpoint: str | None = None
    azure_foundry_runtime_api_version: str | None = None
    azure_openai_api_version: str | None = None
    azure_foundry_chat_model_deployment: str | None = None
    azure_openai_chat_deployment: str | None = None
    azure_openai_api_key: str | None = None
    azure_foundry_api_key: str | None = None
    azure_client_id: str | None = None

    azure_cosmos_endpoint: str | None = None
    azure_cosmos_key: str | None = None
    azure_cosmos_webchat_database_name: str | None = None
    azure_cosmos_webchat_sessions_container_name: str = "chat_sessions"
    azure_cosmos_webchat_messages_container_name: str = "chat_messages"
    azure_cosmos_webchat_documents_container_name: str = "webchat_documents"

    session_upload_max_file_count: int = 10
    session_upload_max_file_size_bytes: int = 25 * 1024 * 1024
    session_upload_supported_extensions: str = ".txt,.md,.csv,.json,.pdf,.docx"

    chat_max_message_length: int = 12000

    @property
    def openai_endpoint(self) -> str | None:
        return self.azure_openai_endpoint or self.azure_foundry_api_endpoint

    @property
    def openai_api_version(self) -> str:
        return (
            self.azure_openai_api_version
            or self.azure_foundry_runtime_api_version
            or "2024-10-21"
        )

    @property
    def openai_deployment(self) -> str | None:
        return _deployment_name(
            self.azure_openai_chat_deployment or self.azure_foundry_chat_model_deployment
        )

    @property
    def openai_api_key(self) -> str | None:
        return self.azure_openai_api_key or self.azure_foundry_api_key

    @property
    def cosmos_database_name(self) -> str | None:
        return self.azure_cosmos_webchat_database_name

    @property
    def supported_extensions(self) -> set[str]:
        return {
            item.strip().lower()
            for item in self.session_upload_supported_extensions.split(",")
            if item.strip()
        }


def _deployment_name(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    if not stripped.startswith("{"):
        return stripped
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        return stripped
    if isinstance(parsed, dict):
        name = parsed.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return stripped

@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    (settings.data_dir / "uploads").mkdir(parents=True, exist_ok=True)
    return settings


def reload_settings() -> Settings:
    load_environment(override=True)
    get_settings.cache_clear()
    return get_settings()
