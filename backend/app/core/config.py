import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv(".env.local")


@dataclass(frozen=True, slots=True)
class Settings:
    environment: str = os.getenv("APP_ENV", "development")
    extraction_provider: str = os.getenv("EXTRACTION_PROVIDER", "development")
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    gemini_api_key: str | None = os.getenv("GEMINI_API_KEY")
    xai_api_key: str | None = os.getenv("XAI_API_KEY")
    openai_extraction_model: str = os.getenv("OPENAI_EXTRACTION_MODEL", "gpt-6-astra")
    openai_pdf_model: str = os.getenv("OPENAI_PDF_MODEL", "gpt-6-sol")
    gemini_pdf_model: str = os.getenv("GEMINI_PDF_MODEL", "gemini-3.8-flash")
    xai_pdf_model: str = os.getenv("XAI_PDF_MODEL", "grok-4.7")
    openai_realtime_model: str = os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime-2.1")
    max_upload_bytes: int = int(os.getenv("MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))


settings = Settings()
