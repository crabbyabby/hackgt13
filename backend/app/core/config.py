import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    environment: str = os.getenv("APP_ENV", "development")
    extraction_provider: str = os.getenv("EXTRACTION_PROVIDER", "development")
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    openai_extraction_model: str = os.getenv("OPENAI_EXTRACTION_MODEL", "gpt-6-astra")
    openai_realtime_model: str = os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime-2.1")
    max_upload_bytes: int = int(os.getenv("MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))


settings = Settings()
