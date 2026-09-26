from backend.app.domain.models import ExtractionJob, SemanticNote


class InMemoryRepository:
    """Development-only storage; data is lost on restart."""

    def __init__(self) -> None:
        self.notes: dict[str, SemanticNote] = {}
        self.jobs: dict[str, ExtractionJob] = {}

    async def save(self, value: SemanticNote | ExtractionJob):
        if isinstance(value, SemanticNote):
            self.notes[value.id] = value
        else:
            self.jobs[value.id] = value
        return value

    async def find_by_id(self, value_id: str):
        return self.notes.get(value_id) or self.jobs.get(value_id)

    async def find_by_slug(self, slug: str) -> SemanticNote | None:
        return next((note for note in self.notes.values() if note.slug == slug), None)


# TODO(storage): Implement durable repositories for notes, jobs, source assets,
# publication revisions, and audit events. Add ownership and optimistic locking.
