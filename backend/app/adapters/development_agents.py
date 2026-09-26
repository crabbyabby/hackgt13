from __future__ import annotations

import re

from backend.app.domain.inputs import PipelineContext
from backend.app.domain.models import (
    BlockKind,
    MathNode,
    MathVariable,
    NoteBlock,
    NoteSource,
    PipelineStage,
    SemanticNote,
    SourceKind,
    SourceRegion,
)


class DevelopmentIngestAgent:
    stage = PipelineStage.INGEST

    async def run(self, context: PipelineContext) -> PipelineContext:
        context.page_count = 2 if context.source.content_type == "application/pdf" else 1
        context.report(self.stage, "Normalized source pages and captured source metadata.")
        return context


class DevelopmentLayoutAgent:
    stage = PipelineStage.LAYOUT

    async def run(self, context: PipelineContext) -> PipelineContext:
        context.blocks.extend(
            [
                NoteBlock(
                    kind=BlockKind.HEADING,
                    text="Eigenvalues and eigenvectors",
                    confidence=0.99,
                    needsReview=False,
                    sourceRegion=SourceRegion(page=1, x=8, y=8, width=70, height=9),
                ),
                NoteBlock(
                    kind=BlockKind.PARAGRAPH,
                    text="A nonzero vector x is an eigenvector of a square matrix A when applying A changes its scale but not its direction.",
                    confidence=0.94,
                    needsReview=False,
                    sourceRegion=SourceRegion(page=1, x=8, y=21, width=80, height=17),
                ),
                NoteBlock(
                    kind=BlockKind.ANNOTATION,
                    text="Common mistake: x cannot be the zero vector.",
                    confidence=0.91,
                    needsReview=False,
                    sourceRegion=SourceRegion(page=2, x=10, y=70, width=68, height=10),
                ),
            ]
        )
        context.report(self.stage, "Recovered headings, paragraphs, annotations, and reading order.")
        return context


class DevelopmentMathAgent:
    stage = PipelineStage.MATH

    async def run(self, context: PipelineContext) -> PipelineContext:
        context.blocks.insert(
            2,
            NoteBlock(
                kind=BlockKind.EQUATION,
                text="The defining eigenvalue equation.",
                confidence=0.88,
                needsReview=True,
                math=MathNode(
                    latex=r"A x = \lambda x",
                    spoken="A times x equals lambda times x",
                    label="Eigenvalue equation",
                    variables=[
                        MathVariable(symbol="A", meaning="Square matrix or linear transformation"),
                        MathVariable(symbol="x", meaning="Nonzero eigenvector"),
                        MathVariable(symbol="λ", meaning="Eigenvalue; the scale factor"),
                    ],
                ),
                sourceRegion=SourceRegion(page=1, x=18, y=42, width=45, height=11),
            ),
        )
        context.report(self.stage, "Parsed notation, variable roles, LaTeX, and spoken math.")
        return context


class DevelopmentVisualAgent:
    stage = PipelineStage.VISUALS

    async def run(self, context: PipelineContext) -> PipelineContext:
        context.blocks.append(
            NoteBlock(
                kind=BlockKind.GRAPH,
                title="Vector transformation diagram",
                text="The diagram compares x with A x.",
                altText="Two vectors start at the origin and point in the same direction. A x is longer than x, illustrating a positive eigenvalue greater than one.",
                confidence=0.81,
                needsReview=True,
                sourceRegion=SourceRegion(page=min(2, context.page_count), x=9, y=12, width=62, height=42),
            )
        )
        context.report(self.stage, "Identified a diagram and drafted a structural description.")
        return context


class DevelopmentReconciliationAgent:
    stage = PipelineStage.RECONCILE

    async def run(self, context: PipelineContext) -> PipelineContext:
        # TODO(ai): Compare independent agent outputs and surrounding notation.
        context.report(self.stage, "Reconciled ambiguous notation against nearby definitions.")
        return context


class DevelopmentAccessibilityCompiler:
    stage = PipelineStage.ACCESSIBILITY

    async def run(self, context: PipelineContext) -> PipelineContext:
        title = next(
            (block.text for block in context.blocks if block.kind == BlockKind.HEADING), "Untitled notes"
        )
        context.note = SemanticNote(
            slug=re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", title.lower())) or "untitled-note",
            title=title,
            course="MATH 1554 · Linear Algebra",
            source=NoteSource(
                name=context.source.filename,
                kind=SourceKind.PDF if context.source.content_type == "application/pdf" else SourceKind.IMAGE,
                pageCount=context.page_count,
            ),
            blocks=context.blocks,
        )
        context.report(self.stage, "Compiled and validated the semantic document.")
        return context


def development_agents():
    return [
        DevelopmentIngestAgent(),
        DevelopmentLayoutAgent(),
        DevelopmentMathAgent(),
        DevelopmentVisualAgent(),
        DevelopmentReconciliationAgent(),
        DevelopmentAccessibilityCompiler(),
    ]
