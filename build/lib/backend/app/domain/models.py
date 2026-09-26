from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(UTC)


class SourceKind(StrEnum):
    PDF = "pdf"
    IMAGE = "image"


class BlockKind(StrEnum):
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    EQUATION = "equation"
    GRAPH = "graph"
    DIAGRAM = "diagram"
    ANNOTATION = "annotation"


class PipelineStage(StrEnum):
    INGEST = "ingest"
    LAYOUT = "layout"
    MATH = "math"
    VISUALS = "visuals"
    RECONCILE = "reconcile"
    ACCESSIBILITY = "accessibility"


class SourceRegion(BaseModel):
    page: int = Field(ge=1)
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    width: float = Field(gt=0, le=100)
    height: float = Field(gt=0, le=100)


class MathVariable(BaseModel):
    symbol: str
    meaning: str


class MathIntegral(BaseModel):
    integrand: MathExpressionNode
    variable: str
    lowerBound: MathExpressionNode | None = None
    upperBound: MathExpressionNode | None = None


class MathDerivative(BaseModel):
    expression: MathExpressionNode
    variable: str
    order: int = Field(default=1, ge=1)


class MathExpressionNode(BaseModel):
    """A recursively navigable part of a mathematical expression."""

    latex: str
    spoken: str | None = None
    mathml: str | None = None
    numerator: MathExpressionNode | None = None
    denominator: MathExpressionNode | None = None
    radicand: MathExpressionNode | None = None
    rootIndex: MathExpressionNode | None = None
    base: MathExpressionNode | None = None
    exponent: MathExpressionNode | None = None
    matrixRows: list[list[MathExpressionNode]] = Field(default_factory=list)
    matrixColumns: list[list[MathExpressionNode]] = Field(default_factory=list)
    alignedSteps: list[MathExpressionNode] = Field(default_factory=list)
    integral: MathIntegral | None = None
    derivative: MathDerivative | None = None


class MathNode(BaseModel):
    latex: str
    spoken: str
    label: str
    variables: list[MathVariable] = Field(default_factory=list)
    # Rendered accessible notation. `mathml` is None when `latex` failed to compile,
    # which forces the owning block back to human review.
    mathml: str | None = None
    mathmlError: str | None = None
    numerator: MathExpressionNode | None = None
    denominator: MathExpressionNode | None = None
    radicand: MathExpressionNode | None = None
    rootIndex: MathExpressionNode | None = None
    base: MathExpressionNode | None = None
    exponent: MathExpressionNode | None = None
    matrixRows: list[list[MathExpressionNode]] = Field(default_factory=list)
    matrixColumns: list[list[MathExpressionNode]] = Field(default_factory=list)
    alignedSteps: list[MathExpressionNode] = Field(default_factory=list)
    integral: MathIntegral | None = None
    derivative: MathDerivative | None = None


class NoteInterpretation(BaseModel):
    reading: str
    latex: str | None = None
    confidence: float = Field(ge=0, le=1)
    evidence: str


class NoteBlock(BaseModel):
    id: str = Field(default_factory=lambda: f"block_{uuid4().hex}")
    kind: BlockKind
    title: str | None = None
    text: str
    math: MathNode | None = None
    altText: str | None = None
    sourceRegion: SourceRegion | None = None
    confidence: float = Field(ge=0, le=1)
    needsReview: bool
    interpretations: list[NoteInterpretation] = Field(default_factory=list)


class NoteSource(BaseModel):
    name: str
    kind: SourceKind
    pageCount: int = Field(ge=1)
    aiProvider: str | None = None
    aiModel: str | None = None


class SemanticNote(BaseModel):
    id: str = Field(default_factory=lambda: f"note_{uuid4().hex}")
    slug: str
    title: str
    course: str | None = None
    source: NoteSource
    blocks: list[NoteBlock]
    status: Literal["draft", "published"] = "draft"
    createdAt: datetime = Field(default_factory=utc_now)
    updatedAt: datetime = Field(default_factory=utc_now)
    schemaVersion: int = 1


class StageReport(BaseModel):
    stage: PipelineStage
    summary: str


class ExtractionResult(BaseModel):
    note: SemanticNote
    provider: Literal["development", "openai"]
    stages: list[StageReport]


class ExtractionJob(BaseModel):
    id: str = Field(default_factory=lambda: f"job_{uuid4().hex}")
    status: Literal["queued", "running", "needs-review", "failed"] = "queued"
    sourceName: str
    currentStage: PipelineStage | None = None
    completedStages: list[PipelineStage] = Field(default_factory=list)
    noteId: str | None = None
    error: str | None = None
    createdAt: datetime = Field(default_factory=utc_now)
    updatedAt: datetime = Field(default_factory=utc_now)


class ExtractionJobResponse(BaseModel):
    job: ExtractionJob
    note: SemanticNote | None = None
