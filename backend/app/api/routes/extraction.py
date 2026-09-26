from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from backend.app.core.config import settings
from backend.app.core.container import extraction_pipeline, repository
from backend.app.domain.inputs import SourceDocument
from backend.app.domain.models import ExtractionJobResponse

router = APIRouter(prefix="/extraction-jobs", tags=["extraction"])
ALLOWED_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/heic", "image/webp"}


@router.post("", response_model=ExtractionJobResponse, status_code=status.HTTP_201_CREATED)
async def create_extraction_job(file: Annotated[UploadFile, File()]) -> ExtractionJobResponse:
    content_type = file.content_type or "application/octet-stream"
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Use a PDF, PNG, JPG, HEIC, or WebP file.")
    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Upload exceeds the configured size limit.")
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    # TODO(security): Inspect magic bytes, malware-scan, and store the source before queuing.
    result = await extraction_pipeline.execute(
        SourceDocument(filename=file.filename or "notes", content_type=content_type, content=content)
    )
    if result.job.status == "failed":
        raise HTTPException(status_code=502, detail=result.job.error or "Extraction failed")
    return result


@router.get("/{job_id}")
async def get_extraction_job(job_id: str):
    job = await repository.find_by_id(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {"job": job}
