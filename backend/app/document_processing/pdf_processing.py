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
        label="Astra — highest fidelity",
        description="Use when dense handwriting, diagrams, or ambiguous notation need maximum reasoning.",
        recommendedFor="final extraction and difficult notes",
    ),
    PdfModelOption(
        provider=AiProvider.OPENAI,
        id="gpt-6-sol",
        label="Sol — balanced",
        description="Balances transcription quality, latency, and cost for most course notes.",
        recommendedFor="default processing",
    ),
    PdfModelOption(
        provider=AiProvider.OPENAI,
        id="gpt-6-luna",
        label="Luna — fastest",
        description="Use for quick drafts that will receive careful human review.",
        recommendedFor="rapid previews and simple notes",
    ),
    PdfModelOption(
        provider=AiProvider.GOOGLE,
        id="gemini-3.8-flash",
        label="Gemini 3.8 Flash — recommended",
        description="Google's current production multimodal model with native PDF understanding.",
        recommendedFor="high-quality document extraction",
    ),
    PdfModelOption(
        provider=AiProvider.GOOGLE,
        id="gemini-3.7-flash",
        label="Gemini 3.7 Flash — previous generation",
        description="A stable multimodal alternative for comparing transcription quality.",
        recommendedFor="evaluation and fallback processing",
    ),
    PdfModelOption(
        provider=AiProvider.GOOGLE,
        id="gemini-3.5-flash-lite",
        label="Gemini 3.5 Flash-Lite — economical",
        description="Lower-cost Google model for simpler, clearly written notes.",
        recommendedFor="fast drafts and clean handwriting",
    ),
    PdfModelOption(
        provider=AiProvider.XAI,
        id="grok-4.7",
        label="Grok 4.7 — experimental PDF",
        description="xAI's current flagship with PDF attachment search; evaluate carefully on handwriting.",
        recommendedFor="provider comparison and evaluation",
    ),
    PdfModelOption(
        provider=AiProvider.XAI,
        id="grok-4.6",
        label="Grok 4.6 — comparison",
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
    color: str
    visualStyle: str
    relationships: list[str]
    interpretations: list[InterpretationCandidate] = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    needsReview: bool


class PageTranscription(BaseModel):
    pageNumber: int = Field(ge=1)
    rawTranscription: str
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


class PdfProcessor(Protocol):
    async def process(self, *, filename: str, content: bytes, model: str | None = None) -> PdfTranscription:
        ...


class PdfProcessingError(RuntimeError):
    pass


_TRANSCRIPTION_INSTRUCTIONS = """
You are the loss-aware transcription stage for EigenScribe. Transcribe the complete PDF before any
semantic rewriting. Account for every visible handwritten or printed mark on every page, including
titles, prose, equations, derivation steps, matrices, subscripts, superscripts, crossed-out work,
arrows, circles, underlines, highlights, colors, labels, marginal notes, diagrams, graphs, tables,
axes, legends, doodles that may carry meaning, and isolated marks.

For each region, preserve an exact visual/verbatim reading separately from normalized interpretations.
Never silently repair spelling, notation, or mathematical reasoning in `verbatim`. For mathematics,
put normalized mathematical candidates in `latex`. If a mark is unclear, write `[illegible]` or an
equally precise placeholder in the verbatim text, set needsReview, and include every plausible reading
as a separate interpretation with its own confidence and brief visible evidence. Do not collapse
arrows, colors, highlights, spatial grouping, or crossed-out content into ordinary prose; record their
relationships and visual style. Do not invent invisible content. Include stray or unassigned marks.

`rawTranscription` must be an exhaustive, reading-order-preserving page record. Region IDs must be
unique within the document, and `readingOrder` must reference those IDs. Confidence values are your
self-assessment from 0 to 1 and must be lower when handwriting, notation, layout, or relationships are
ambiguous. The output will be reviewed by a person and then transformed into semantic learning content.
""".strip()


class OpenAIPdfProcessor:
    def __init__(self, *, api_key: str, default_model: str) -> None:
        if not api_key:
            raise ValueError("OPENAI_API_KEY is required to use OpenAI PDF models.")
        self.client = AsyncOpenAI(api_key=api_key)
        self.default_model = validate_pdf_model(AiProvider.OPENAI, default_model)

    async def process(self, *, filename: str, content: bytes, model: str | None = None) -> PdfTranscription:
        if not content:
            raise PdfProcessingError("Cannot process an empty PDF.")
        selected_model = validate_pdf_model(AiProvider.OPENAI, model or self.default_model)
        encoded = base64.b64encode(content).decode("ascii")
        try:
            response = await self.client.responses.parse(
                model=selected_model,
                store=False,
                instructions=_TRANSCRIPTION_INSTRUCTIONS,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_file",
                                "filename": filename,
                                "file_data": f"data:application/pdf;base64,{encoded}",
                                "detail": "high",
                            },
                            {
                                "type": "input_text",
                                "text": "Transcribe this PDF completely into the required loss-aware schema.",
                            },
                        ],
                    }
                ],
                text_format=PdfTranscriptionPayload,
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
    def __init__(self, *, api_key: str, default_model: str) -> None:
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
                    _TRANSCRIPTION_INSTRUCTIONS,
                    "Return the complete transcription as JSON matching the supplied schema.",
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=PdfTranscriptionPayload,
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
    def __init__(self, *, api_key: str, default_model: str) -> None:
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
                instructions=_TRANSCRIPTION_INSTRUCTIONS,
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
                    logger.warning("Could not delete temporary xAI file %s: %s", uploaded_file.id, cleanup_error)

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
