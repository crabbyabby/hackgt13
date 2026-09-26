from dataclasses import dataclass, field

from .models import NoteBlock, PipelineStage, SemanticNote, StageReport


@dataclass(slots=True)
class SourceDocument:
    filename: str
    content_type: str
    content: bytes


@dataclass(slots=True)
class PipelineContext:
    source: SourceDocument
    page_count: int = 1
    blocks: list[NoteBlock] = field(default_factory=list)
    note: SemanticNote | None = None
    reports: list[StageReport] = field(default_factory=list)

    def report(self, stage: PipelineStage, summary: str) -> None:
        self.reports.append(StageReport(stage=stage, summary=summary))
