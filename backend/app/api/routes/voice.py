from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from backend.app.core.config import settings
from backend.app.core.container import (
    elevenlabs_voice_service,
    math_narration_service,
    voice_navigation_service,
)
from backend.app.domain.models import SemanticNote
from backend.app.services.voice import VoiceProviderError, VoiceProviderUnavailable

router = APIRouter(prefix="/voice", tags=["voice"])


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


class NavigationRequest(BaseModel):
    note: SemanticNote
    index: int = Field(ge=0)
    command: str = Field(min_length=1, max_length=500)


class NarrationRequest(BaseModel):
    note: SemanticNote
    blockIndex: int | None = Field(default=None, ge=0)


@router.get("/config")
async def voice_config():
    return {
        "provider": "elevenlabs",
        "available": bool(settings.elevenlabs_api_key),
        "agentAvailable": bool(settings.elevenlabs_api_key and settings.elevenlabs_agent_id),
        "voiceId": settings.elevenlabs_voice_id,
        "ttsModel": settings.elevenlabs_tts_model,
        "sttModel": settings.elevenlabs_stt_model,
    }


@router.get("/agent/signed-url")
async def create_agent_signed_url():
    try:
        signed_url = await elevenlabs_voice_service.create_agent_signed_url(
            settings.elevenlabs_agent_id
        )
    except VoiceProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except VoiceProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"signedUrl": signed_url}


@router.post("/speech")
async def create_speech(body: SpeechRequest):
    try:
        audio = await elevenlabs_voice_service.synthesize(body.text)
    except VoiceProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except VoiceProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "private, no-store"})


@router.post("/narration")
async def create_narration(body: NarrationRequest):
    if body.blockIndex is not None and body.blockIndex >= len(body.note.blocks):
        raise HTTPException(status_code=422, detail="The requested note block does not exist.")
    script = await math_narration_service.prepare(body.note, body.blockIndex)
    try:
        audio = await elevenlabs_voice_service.synthesize(script)
    except VoiceProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except VoiceProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "private, no-store"},
    )


@router.post("/narration/script")
async def create_narration_script(body: NarrationRequest):
    if body.blockIndex is not None and body.blockIndex >= len(body.note.blocks):
        raise HTTPException(status_code=422, detail="The requested note block does not exist.")
    script = await math_narration_service.prepare(body.note, body.blockIndex)
    return {"script": script}


@router.post("/transcriptions")
async def create_transcription(file: Annotated[UploadFile, File()]):
    content = await file.read(settings.max_voice_upload_bytes + 1)
    if len(content) > settings.max_voice_upload_bytes:
        raise HTTPException(status_code=413, detail="Voice command recording is too large.")
    if not content:
        raise HTTPException(status_code=400, detail="The voice command recording is empty.")
    try:
        return await elevenlabs_voice_service.transcribe(
            filename=file.filename or "voice-command.webm",
            content=content,
            content_type=file.content_type or "audio/webm",
        )
    except VoiceProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except VoiceProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/navigation")
async def resolve_navigation(body: NavigationRequest):
    return voice_navigation_service.resolve(note=body.note, index=body.index, command=body.command)
