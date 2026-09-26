from backend.app.domain.models import SemanticNote, utc_now
from backend.app.ports.repositories import NoteRepository


class PublicationService:
    def __init__(self, notes: NoteRepository) -> None:
        self.notes = notes

    async def publish(self, note: SemanticNote) -> tuple[SemanticNote, str]:
        # TODO(review): Block publication until uncertain blocks are accepted or corrected.
        # TODO(render): Produce semantic HTML/MathML and downloadable artifacts.
        # TODO(revisions): Store an immutable publication revision and audit event.
        note.status = "published"
        note.updatedAt = utc_now()
        await self.notes.save(note)
        return note, f"/notes/{note.slug}"
