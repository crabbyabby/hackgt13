import pytest

from backend.app.adapters.development_agents import development_agents
from backend.app.adapters.memory import InMemoryRepository
from backend.app.domain.inputs import SourceDocument
from backend.app.services.extraction import ExtractionPipeline


@pytest.mark.asyncio
async def test_development_pipeline_produces_reviewable_semantic_note():
    repository = InMemoryRepository()
    pipeline = ExtractionPipeline(development_agents(), repository, repository)

    result = await pipeline.execute(
        SourceDocument(filename="notes.pdf", content_type="application/pdf", content=b"fixture")
    )

    assert result.job.status == "needs-review"
    assert result.note is not None
    assert len(result.note.blocks) == 5
    assert any(block.math is not None for block in result.note.blocks)
    assert any(block.altText for block in result.note.blocks)
    assert len(result.job.completedStages) == 6
