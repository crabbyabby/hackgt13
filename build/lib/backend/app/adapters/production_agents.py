from backend.app.domain.inputs import PipelineContext
from backend.app.domain.models import PipelineStage


class TodoProductionAgent:
    """Placeholder for each external AI/document-processing integration."""

    def __init__(self, stage: PipelineStage) -> None:
        self.stage = stage

    async def run(self, _context: PipelineContext) -> PipelineContext:
        # TODO(integration): Implement the selected provider for this stage.
        # INGEST: PDF rasterization, orientation, image cleanup, secure object storage.
        # LAYOUT: region detection, reading order, annotations, color/emphasis.
        # MATH: handwriting/math OCR, LaTeX, expression tree, spoken notation.
        # VISUALS: graphs/diagrams, labels, geometry, data, accessible description.
        # RECONCILE: multi-agent comparison, context resolution, confidence scoring.
        # ACCESSIBILITY: schema validation, MathML-ready structure, review flags.
        raise NotImplementedError(f"Production agent for {self.stage.value} is not implemented")


def production_agents():
    return [TodoProductionAgent(stage) for stage in PipelineStage]
