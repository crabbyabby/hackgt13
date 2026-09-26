from typing import Protocol

from backend.app.domain.inputs import PipelineContext
from backend.app.domain.models import PipelineStage


class PipelineAgent(Protocol):
    stage: PipelineStage

    async def run(self, context: PipelineContext) -> PipelineContext: ...
