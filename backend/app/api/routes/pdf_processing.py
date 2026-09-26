from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from backend.app.core.config import settings
from backend.app.core.container import pdf_processing_service
from backend.app.document_processing.pdf_processing import (
    PdfModelOption,
    PdfProcessingError,
    PdfTranscription,
)

router = APIRouter(prefix="/pdf-processing", tags=["pdf-processing"])


@router.get("/models", response_model=list[PdfModelOption])
async def list_pdf_models() -> tuple[PdfModelOption, ...]:
    return tuple(pdf_processing_service.models())


@router.post("/transcriptions", response_model=PdfTranscription, status_code=status.HTTP_201_CREATED)
async def create_pdf_transcription(
    file: Annotated[UploadFile, File()],
    provider: Annotated[str | None, Form()] = None,
    model: Annotated[str, Form()] = "development-fixture",
) -> PdfTranscription:
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=415, detail="This endpoint accepts PDF files only.")
    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Upload exceeds the configured size limit.")
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded PDF is empty.")
    try:
        return await pdf_processing_service.transcribe(
            filename=file.filename or "notes.pdf", content=content, provider=provider, model=model
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except PdfProcessingError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
