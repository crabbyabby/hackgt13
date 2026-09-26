from fastapi import APIRouter, HTTPException

from backend.app.core.container import publication_service, repository
from backend.app.domain.models import SemanticNote, utc_now

router = APIRouter(prefix="/notes", tags=["notes"])


@router.get("/{slug}")
async def get_note(slug: str):
    note = await repository.find_by_slug(slug)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found.")
    return {"note": note}


@router.put("/{slug}")
async def update_note(slug: str, note: SemanticNote):
    if note.slug != slug:
        raise HTTPException(status_code=400, detail="Payload slug does not match route.")
    # TODO(auth): Authorize the editor and enforce optimistic versioning.
    note.updatedAt = utc_now()
    await repository.save(note)
    return {"note": note}


@router.post("/{slug}/publish")
async def publish_note(slug: str):
    note = await repository.find_by_slug(slug)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found.")
    published, path = await publication_service.publish(note)
    return {"note": published, "path": path}
