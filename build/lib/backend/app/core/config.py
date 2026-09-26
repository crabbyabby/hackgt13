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
    elevenlabs_api_key: str | None = os.getenv("ELEVENLABS_API_KEY")
    elevenlabs_agent_id: str | None = os.getenv("ELEVENLABS_AGENT_ID")
    elevenlabs_voice_id: str = os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
    elevenlabs_tts_model: str = os.getenv("ELEVENLABS_TTS_MODEL", "eleven_v3")
    elevenlabs_stt_model: str = os.getenv("ELEVENLABS_STT_MODEL", "scribe_v2")
    max_voice_upload_bytes: int = int(os.getenv("MAX_VOICE_UPLOAD_BYTES", str(25 * 1024 * 1024)))
    narration_model: str = os.getenv("NARRATION_MODEL", "gpt-6-luna")
    openai_realtime_model: str = os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime-2.1")
    # Reasoning effort spent before transcription output begins. "low" measurably degraded
    # structure: matrices and column vectors came back flattened to inline lists like
    # [3; -2; -1; 0] instead of a real bmatrix, which is a correctness failure for a screen
    # reader, not a formatting one. Quality is the default; lower it only for throwaway runs.
    # One of: none, minimal, low, medium, high.
    transcription_effort: str = os.getenv("TRANSCRIPTION_EFFORT", "medium")
    # Whether the model first writes a plain-prose reading of each page before emitting
    # structured regions. It costs output tokens, but it grounds the structured pass;
    # removing it alongside the effort cut is what collapsed matrix structure.
    transcription_raw_pass: bool = os.getenv("TRANSCRIPTION_RAW_PASS", "true").lower() != "false"
    max_upload_bytes: int = int(os.getenv("MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))


settings = Settings()
