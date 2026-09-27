"""Loss-aware PDF handwriting transcription before semantic transformation.

This module deliberately stops at faithful transcription. A later pipeline stage can
turn the result into headings, equations, derivations, graph descriptions, and other
semantic blocks without having to reinterpret the original PDF from scratch.
"""

from __future__ import annotations

import base64
import hashlib
import logging
from enum import StrEnum
from typing import Literal, Protocol

from google import genai
from google.genai import types
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class AiProvider(StrEnum):
    DEVELOPMENT = "development"
    OPENAI = "openai"
    GOOGLE = "google"
    XAI = "xai"


class PdfModelOption(BaseModel):
    provider: AiProvider
    id: str
    label: str
    description: str
    recommendedFor: str
    available: bool = False


_PDF_MODELS = (
    PdfModelOption(
        provider=AiProvider.OPENAI,
        id="gpt-6-astra",
        label="Astra",
        description="Use when dense handwriting, diagrams, or ambiguous notation need maximum reasoning.",
        recommendedFor="final extraction and difficult notes",
    ),
    PdfModelOption(
        provider=AiProvider.OPENAI,
        id="gpt-6-sol",
        label="Sol",
        description="Balances transcription quality, latency, and cost for most course notes.",
        recommendedFor="default processing",
    ),
    PdfModelOption(
        provider=AiProvider.OPENAI,
        id="gpt-6-luna",
        label="Luna",
        description="Use for quick drafts that will receive careful human review.",
        recommendedFor="rapid previews and simple notes",
    ),
    PdfModelOption(
        provider=AiProvider.GOOGLE,
        id="gemini-3.8-flash",
        label="Gemini 3.8 Flash",
        description="Google's current production multimodal model with native PDF understanding.",
        recommendedFor="high-quality document extraction",
    ),
    PdfModelOption(
        provider=AiProvider.GOOGLE,
        id="gemini-3.7-flash",
        label="Gemini 3.7 Flash",
        description="A stable multimodal alternative for comparing transcription quality.",
        recommendedFor="evaluation and fallback processing",
    ),
    PdfModelOption(
        provider=AiProvider.GOOGLE,
        id="gemini-3.5-flash-lite",
        label="Gemini 3.5 Flash-Lite",
        description="Lower-cost Google model for simpler, clearly written notes.",
        recommendedFor="fast drafts and clean handwriting",
    ),
    PdfModelOption(
        provider=AiProvider.XAI,
        id="grok-4.7",
        label="Grok 4.7",
        description="xAI's current flagship with PDF attachment search; evaluate carefully on handwriting.",
        recommendedFor="provider comparison and evaluation",
    ),
    PdfModelOption(
        provider=AiProvider.XAI,
        id="grok-4.6",
        label="Grok 4.6",
        description="Previous Grok generation retained for extraction comparisons.",
        recommendedFor="evaluation and fallback processing",
    ),
    PdfModelOption(
        provider=AiProvider.DEVELOPMENT,
        id="development-fixture",
        label="Development fixture — no API call",
        description="Returns deterministic example data so the workflow works without an API key.",
        recommendedFor="local UI development only",
        available=True,
    ),
)


def supported_pdf_models() -> tuple[PdfModelOption, ...]:
    return _PDF_MODELS


def validate_pdf_model(provider: AiProvider, model: str) -> str:
    supported = {option.id for option in _PDF_MODELS if option.provider == provider}
    if model not in supported:
        choices = ", ".join(sorted(supported))
        raise ValueError(f"Unsupported {provider.value} PDF model '{model}'. Choose one of: {choices}.")
    return model


def provider_for_model(model: str) -> AiProvider:
    match = next((option.provider for option in _PDF_MODELS if option.id == model), None)
    if match is None:
        raise ValueError(f"Unsupported PDF model '{model}'.")
    return match


class BoundingBox(BaseModel):
    """Approximate location, expressed as percentages of the page."""

    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    width: float = Field(gt=0, le=100)
    height: float = Field(gt=0, le=100)


class InterpretationCandidate(BaseModel):
    """A plausible reading; confidence is model-reported, not calibrated probability."""

    reading: str
    latex: str | None
    confidence: float = Field(ge=0, le=1)
    evidence: str


class TranscribedRegion(BaseModel):
    id: str
    kind: Literal[
        "handwriting",
        "printed_text",
        "heading",
        "equation",
        "diagram",
        "graph",
        "table",
        "annotation",
        "arrow",
        "highlight",
        "strikeout",
        "other",
    ]
    bounds: BoundingBox
    verbatim: str
    # These must be first-class fields. Previously the prompt requested `latex`, but
    # the structured-output schema did not contain it, so valid model LaTeX was dropped
    # and raw OCR text was later presented as notation.
    latex: str | None = None
    spoken: str | None = None
    description: str | None = None
    color: str
    visualStyle: str
    relationships: list[str]
    # Empty when the reading is unambiguous. Alternates are only worth their latency
    # and token cost where the model is actually uncertain.
    interpretations: list[InterpretationCandidate] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    needsReview: bool


class PageTranscription(BaseModel):
    pageNumber: int = Field(ge=1)
    # Fallback only. When regions are produced this stays empty: emitting the page as
    # both prose and structured regions doubles output tokens, and output length is the
    # dominant term in generation latency.
    rawTranscription: str = ""
    readingOrder: list[str]
    regions: list[TranscribedRegion]
    unassignedMarks: list[str]
    pageConfidence: float = Field(ge=0, le=1)
    coverageNotes: str


class PdfTranscriptionPayload(BaseModel):
    documentTitle: str | None
    pageCount: int = Field(ge=1)
    pages: list[PageTranscription] = Field(min_length=1)
    overallConfidence: float = Field(ge=0, le=1)
    warnings: list[str]


class PdfTranscription(PdfTranscriptionPayload):
    sourceName: str
    sourceSha256: str
    sourceByteCount: int = Field(ge=1)
    provider: AiProvider
    model: str
    confidenceBasis: Literal["model_self_reported", "development_fixture"]


# Each provider spells "spend less time deliberating" differently. Transcription is a
# perception task, so a low setting is the right default: reasoning tokens are emitted
# before any output and are paid for in full request latency.
_OPENAI_EFFORT = {"none": "none", "minimal": "minimal", "low": "low", "medium": "medium", "high": "high"}
_GEMINI_THINKING_LEVEL = {
    "none": "MINIMAL",
    "minimal": "MINIMAL",
    "low": "LOW",
    "medium": "MEDIUM",
    "high": "HIGH",
}


def _openai_reasoning(effort: str) -> dict | None:
    mapped = _OPENAI_EFFORT.get((effort or "").lower())
    return {"effort": mapped} if mapped else None


def _gemini_thinking(effort: str):
    mapped = _GEMINI_THINKING_LEVEL.get((effort or "").lower())
    return types.ThinkingConfig(thinking_level=mapped) if mapped else None


def best_reading(region: TranscribedRegion) -> InterpretationCandidate:
    """The most likely reading of a region.

    `interpretations` is empty for unambiguous regions, so callers must not assume a
    candidate exists. The verbatim reading stands in, carrying the region's own
    confidence rather than inventing one.
    """
    if region.interpretations:
        return max(region.interpretations, key=lambda candidate: candidate.confidence)
    return InterpretationCandidate(
        reading=region.spoken or region.description or region.verbatim,
        latex=(region.latex or region.verbatim) if region.kind == "equation" else None,
        confidence=region.confidence,
        evidence="Single unambiguous reading; no alternates were reported.",
    )


class PdfProcessor(Protocol):
    async def process(
        self, *, filename: str, content: bytes, model: str | None = None
    ) -> PdfTranscription: ...


class PdfProcessingError(RuntimeError):
    pass


_GROUNDING_INSTRUCTIONS = r"""
Read these course notes as a careful mathematics instructor before converting them to a database.
Produce a complete, page-by-page Markdown transcription that preserves the author's logical flow.
Use headings, full sentences, display LaTeX, aligned derivations, real matrix/vector environments,
and concise diagram descriptions. Include meaningful arrows, colors, highlights, marginal notes,
crossed-out work, and labels, but do not turn notebook ruling, page furniture, or branding into
course content. Do not solve, correct, or silently complete the author's mathematics. Mark genuinely
unclear readings as [illegible] and give plausible alternatives. Keep related prose, annotations,
and derivation steps together so the result reads like coherent notes rather than isolated OCR boxes.
""".strip()


_TRANSCRIPTION_INSTRUCTIONS = r"""
You are the loss-aware structuring stage for EigenScribe. Use both the source PDF and the supplied
grounded Markdown reading. Account for every meaningful handwritten or printed mark on every page, including
titles, prose, equations, derivation steps, matrices, subscripts, superscripts, crossed-out work,
arrows, circles, underlines, highlights, colors, labels, marginal notes, diagrams, graphs, tables,
axes, legends, and doodles that may carry meaning. Ignore notebook ruling, page numbers unrelated to
the lesson, scanner artifacts, and manufacturer branding unless they carry instructional meaning.

A region is a coherent learning unit, not every separately positioned mark. Group a sentence with
its nearby explanatory arrow or annotation. Group a multi-line derivation when the lines form one
argument. Split only at a real heading, paragraph boundary, separate equation/derivation, example,
or visual. Preserve reading order and do not emit fragments such as a lone step label, underline,
dimension label, or arrow when it belongs to the adjacent block.

For each region, preserve an exact visual/verbatim reading in `verbatim`. Never silently repair
spelling, notation, or mathematical reasoning there. For every equation region, put valid LaTeX only
in `latex` and a natural screen-reader rendering in `spoken`. Never put prose, Unicode math glyphs,
semicolon-separated matrix rows, or OCR shorthand in `latex`. Do not collapse arrows, colors,
highlights, spatial grouping, or crossed-out
content into ordinary prose; record their relationships and visual style. Do not invent invisible
content. Put non-instructional or genuinely unassigned marks in `unassignedMarks` instead of making
them paragraph regions.

For every diagram or graph region, put a self-contained visual description in `description`: state
what is drawn, name axes and labels, describe the important shape or relationship, and explain any
color or annotation needed to understand it. Do not merely repeat the graph's short written label.

LaTeX must preserve two-dimensional structure. Write every column vector and matrix with a real
environment: \begin{bmatrix}3\\-2\\-1\\0\end{bmatrix}, and an augmented matrix as
\begin{array}{ccccc|c} ... \end{array} with the vertical rule where the partition is drawn. NEVER
flatten a vector or matrix into an inline list such as [3; -2; -1; 0] or [3 2 0 1 3 | 5; ...]: a
screen reader reads that as a sentence of numbers rather than as a matrix, which reports the wrong
mathematics. Keep a scalar coefficient in the same expression as the vector it multiplies, rather
than emitting the coefficients as separate loose text.

For aligned multi-line equations, put each complete equation on its own row inside an `aligned`
environment. Put `&` only at the alignment point immediately before an operator such as `=`; it is
not visible content. After each `\\`, transcribe the complete next left-hand side, including its
variable before any subscript (for example, write `x_{1}`, never a row beginning with `_1`). Cross-
check every row against both the visible source and `spoken` reading before returning it. Never
concatenate separate equations into one row.

Use `interpretations` only where a reading is genuinely ambiguous. When a mark is unclear, write
`[illegible]` or an equally precise placeholder in `verbatim`, set `needsReview`, and list each
plausible reading with its own confidence and brief visible evidence. When a region is unambiguous,
leave `interpretations` empty rather than restating the obvious reading.

Region IDs must be unique within the document, and
`regions` must already be in reading order. Confidence values are your
self-assessment from 0 to 1 and must be lower when handwriting, notation, layout, or relationships are
ambiguous. The output will be reviewed by a person and then transformed into semantic learning content.
""".strip()

_RAW_PASS_INSTRUCTION = """
First write `rawTranscription` for each page: a complete, reading-order-preserving prose reading of
everything on it. Then produce `regions` from that reading. The prose pass grounds the structured
pass; do not skip it.
""".strip()

_NO_RAW_PASS_INSTRUCTION = """
Put each page's content in `regions` and leave `rawTranscription` empty. Only when a page cannot be
segmented into regions at all, leave `regions` empty and put the whole page in `rawTranscription`.
""".strip()


def transcription_instructions(*, raw_pass: bool) -> str:
    """The prompt, with or without the grounding prose pass."""
    extra = _RAW_PASS_INSTRUCTION if raw_pass else _NO_RAW_PASS_INSTRUCTION
    return f"{_TRANSCRIPTION_INSTRUCTIONS}\n\n{extra}"


class OpenAIPdfProcessor:
    def __init__(
        self,
        *,
        api_key: str,
        default_model: str,
        effort: str = "medium",
        raw_pass: bool = True,
        grounding_pass: bool = True,
    ) -> None:
        self.effort = effort
        self.raw_pass = raw_pass
        self.grounding_pass = grounding_pass
        if not api_key:
            raise ValueError("OPENAI_API_KEY is required to use OpenAI PDF models.")
        self.client = AsyncOpenAI(api_key=api_key)
        self.default_model = validate_pdf_model(AiProvider.OPENAI, default_model)

    async def process(self, *, filename: str, content: bytes, model: str | None = None) -> PdfTranscription:
        if not content:
            raise PdfProcessingError("Cannot process an empty PDF.")
        selected_model = validate_pdf_model(AiProvider.OPENAI, model or self.default_model)
        encoded = base64.b64encode(content).decode("ascii")
        file_input = {
            "type": "input_file",
            "filename": filename,
            "file_data": f"data:application/pdf;base64,{encoded}",
            "detail": "high",
        }
        try:
            grounded = ""
            reasoning = _openai_reasoning(self.effort)
            if self.grounding_pass:
                logger.info(
                    "OpenAI grounding pass start | model=%s file=%r bytes=%d",
                    selected_model,
                    filename,
                    len(content),
                )
                grounding_response = await self.client.responses.create(
                    model=selected_model,
                    store=False,
                    instructions=_GROUNDING_INSTRUCTIONS,
                    input=[
                        {
                            "role": "user",
                            "content": [
                                file_input,
                                {
                                    "type": "input_text",
                                    "text": "Read and transcribe the complete notes. Preserve their mathematical and visual context.",
                                },
                            ],
                        }
                    ],
                    **({"reasoning": reasoning} if reasoning else {}),
                )
                grounded = grounding_response.output_text.strip()
                if not grounded:
                    raise PdfProcessingError("The model returned an empty grounding transcription.")
                logger.info(
                    "OpenAI grounding pass complete | characters=%d preview=%r",
                    len(grounded),
                    grounded[:500],
                )

            structuring_request = "Transcribe this PDF completely into the required loss-aware schema."
            if grounded:
                structuring_request = (
                    "Convert the source PDF into the required schema using the grounded reading below. "
                    "Verify every block against the PDF; the grounded reading is context, not authority.\n\n"
                    "<grounded-reading>\n" + grounded + "\n</grounded-reading>"
                )
            logger.info("OpenAI structuring pass start | model=%s", selected_model)
            response = await self.client.responses.parse(
                model=selected_model,
                store=False,
                instructions=transcription_instructions(raw_pass=self.raw_pass and not grounded),
                input=[
                    {
                        "role": "user",
                        "content": [
                            file_input,
                            {
                                "type": "input_text",
                                "text": structuring_request,
                            },
                        ],
                    }
                ],
                text_format=PdfTranscriptionPayload,
                **({"reasoning": reasoning} if reasoning else {}),
            )
        except Exception as exc:  # SDK/network boundary; normalized for the API layer.
            raise PdfProcessingError(f"OpenAI PDF transcription failed: {exc}") from exc

        payload = response.output_parsed
        if payload is None:
            raise PdfProcessingError("The model returned no structured PDF transcription.")
        return PdfTranscription(
            **payload.model_dump(),
            sourceName=filename,
            sourceSha256=hashlib.sha256(content).hexdigest(),
            sourceByteCount=len(content),
            provider=AiProvider.OPENAI,
            model=selected_model,
            confidenceBasis="model_self_reported",
        )


class GeminiPdfProcessor:
    def __init__(
        self, *, api_key: str, default_model: str, effort: str = "medium", raw_pass: bool = True
    ) -> None:
        self.effort = effort
        self.raw_pass = raw_pass
        if not api_key:
            raise ValueError("GEMINI_API_KEY is required to use Gemini PDF models.")
        self.client = genai.Client(api_key=api_key)
        self.default_model = validate_pdf_model(AiProvider.GOOGLE, default_model)

    async def process(self, *, filename: str, content: bytes, model: str | None = None) -> PdfTranscription:
        if not content:
            raise PdfProcessingError("Cannot process an empty PDF.")
        selected_model = validate_pdf_model(AiProvider.GOOGLE, model or self.default_model)
        try:
            response = await self.client.aio.models.generate_content(
                model=selected_model,
                contents=[
                    types.Part.from_bytes(data=content, mime_type="application/pdf"),
                    transcription_instructions(raw_pass=self.raw_pass),
                    "Return the complete transcription as JSON matching the supplied schema.",
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=PdfTranscriptionPayload,
                    thinking_config=_gemini_thinking(self.effort),
                ),
            )
            payload = PdfTranscriptionPayload.model_validate_json(response.text)
        except Exception as exc:
            raise PdfProcessingError(f"Gemini PDF transcription failed: {exc}") from exc
        return PdfTranscription(
            **payload.model_dump(),
            sourceName=filename,
            sourceSha256=hashlib.sha256(content).hexdigest(),
            sourceByteCount=len(content),
            provider=AiProvider.GOOGLE,
            model=selected_model,
            confidenceBasis="model_self_reported",
        )


class GrokPdfProcessor:
    def __init__(
        self, *, api_key: str, default_model: str, effort: str = "medium", raw_pass: bool = True
    ) -> None:
        self.effort = effort
        self.raw_pass = raw_pass
        if not api_key:
            raise ValueError("XAI_API_KEY is required to use Grok PDF models.")
        self.client = AsyncOpenAI(api_key=api_key, base_url="https://api.x.ai/v1")
        self.default_model = validate_pdf_model(AiProvider.XAI, default_model)

    async def process(self, *, filename: str, content: bytes, model: str | None = None) -> PdfTranscription:
        if not content:
            raise PdfProcessingError("Cannot process an empty PDF.")
        selected_model = validate_pdf_model(AiProvider.XAI, model or self.default_model)
        uploaded_file = None
        try:
            uploaded_file = await self.client.files.create(
                file=(filename, content, "application/pdf"), purpose="assistants"
            )
            response = await self.client.responses.parse(
                model=selected_model,
                store=False,
                instructions=transcription_instructions(raw_pass=self.raw_pass),
                input=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": "Transcribe this PDF completely into the required loss-aware schema.",
                            },
                            {"type": "input_file", "file_id": uploaded_file.id},
                        ],
                    }
                ],
                text_format=PdfTranscriptionPayload,
                **({"reasoning": reasoning} if (reasoning := _openai_reasoning(self.effort)) else {}),
            )
            payload = response.output_parsed
            if payload is None:
                raise PdfProcessingError("Grok returned no structured PDF transcription.")
        except PdfProcessingError:
            raise
        except Exception as exc:
            raise PdfProcessingError(f"Grok PDF transcription failed: {exc}") from exc
        finally:
            if uploaded_file is not None:
                try:
                    await self.client.files.delete(uploaded_file.id)
                except Exception as cleanup_error:  # noqa: BLE001 - best-effort remote cleanup
                    logger.warning(
                        "Could not delete temporary xAI file %s: %s", uploaded_file.id, cleanup_error
                    )

        return PdfTranscription(
            **payload.model_dump(),
            sourceName=filename,
            sourceSha256=hashlib.sha256(content).hexdigest(),
            sourceByteCount=len(content),
            provider=AiProvider.XAI,
            model=selected_model,
            confidenceBasis="model_self_reported",
        )


class DevelopmentPdfProcessor:
    """Deterministic fixture for local UI/backend work without spending API credits."""

    def __init__(self, *, default_model: str = "development-fixture") -> None:
        self.default_model = validate_pdf_model(AiProvider.DEVELOPMENT, default_model)

    async def process(self, *, filename: str, content: bytes, model: str | None = None) -> PdfTranscription:
        selected_model = validate_pdf_model(AiProvider.DEVELOPMENT, model or self.default_model)
        return PdfTranscription(
            sourceName=filename,
            sourceSha256=hashlib.sha256(content).hexdigest(),
            sourceByteCount=len(content),
            provider=AiProvider.DEVELOPMENT,
            model=selected_model,
            confidenceBasis="development_fixture",
            documentTitle="Development transcription fixture",
            pageCount=1,
            pages=[
                PageTranscription(
                    pageNumber=1,
                    rawTranscription="[development fixture — source PDF was not visually inspected] Ax = λx",
                    readingOrder=["region_1"],
                    regions=[
                        TranscribedRegion(
                            id="region_1",
                            kind="equation",
                            bounds=BoundingBox(x=10, y=20, width=50, height=12),
                            verbatim="Ax = λx (final symbol may be x or k)",
                            color="dark ink",
                            visualStyle="handwritten",
                            relationships=[],
                            interpretations=[
                                InterpretationCandidate(
                                    reading="A x equals lambda x",
                                    latex=r"A x = \lambda x",
                                    confidence=0.72,
                                    evidence="The final glyph resembles a handwritten x.",
                                ),
                                InterpretationCandidate(
                                    reading="A x equals lambda k",
                                    latex=r"A x = \lambda k",
                                    confidence=0.28,
                                    evidence="The final glyph could also be a handwritten k.",
                                ),
                            ],
                            confidence=0.72,
                            needsReview=True,
                        )
                    ],
                    unassignedMarks=[],
                    pageConfidence=0.0,
                    coverageNotes="Development fixture only; enable the OpenAI provider for real inspection.",
                )
            ],
            overallConfidence=0.0,
            warnings=["Development fixture returned; the uploaded PDF content was not inspected."],
        )
