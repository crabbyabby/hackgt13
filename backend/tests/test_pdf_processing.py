import hashlib
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.app.document_processing.pdf_processing import (
    DevelopmentPdfProcessor,
    OpenAIPdfProcessor,
    PageTranscription,
    PdfTranscriptionPayload,
    supported_pdf_models,
)
from backend.app.main import app


def test_model_catalog_exposes_quality_latency_choices():
    models = supported_pdf_models()
    assert {model.provider.value for model in models} == {"openai", "google", "xai", "development"}
    assert {"gpt-6-sol", "gemini-3.8-flash", "grok-4.7"} <= {model.id for model in models}


@pytest.mark.asyncio
async def test_development_transcription_preserves_source_identity_and_ambiguity():
    content = b"%PDF-1.7 fixture"
    result = await DevelopmentPdfProcessor().process(
        filename="notes.pdf", content=content, model="development-fixture"
    )

    assert result.sourceSha256 == hashlib.sha256(content).hexdigest()
    assert result.sourceByteCount == len(content)
    assert result.model == "development-fixture"
    assert result.provider.value == "development"
    assert result.confidenceBasis == "development_fixture"
    region = result.pages[0].regions[0]
    assert region.needsReview is True
    assert len(region.interpretations) == 2
    assert all(0 <= candidate.confidence <= 1 for candidate in region.interpretations)


@pytest.mark.asyncio
async def test_openai_processor_sends_pdf_as_structured_file_input():
    payload = PdfTranscriptionPayload(
        documentTitle=None,
        pageCount=1,
        pages=[
            PageTranscription(
                pageNumber=1,
                rawTranscription="complete page",
                readingOrder=[],
                regions=[],
                unassignedMarks=[],
                pageConfidence=0.9,
                coverageNotes="All visible marks accounted for.",
            )
        ],
        overallConfidence=0.9,
        warnings=[],
    )

    class FakeResponses:
        def __init__(self):
            self.arguments = None

        async def parse(self, **kwargs):
            self.arguments = kwargs
            return SimpleNamespace(output_parsed=payload)

    processor = OpenAIPdfProcessor(api_key="test-key", default_model="gpt-6-sol")
    fake_responses = FakeResponses()
    processor.client = SimpleNamespace(responses=fake_responses)

    result = await processor.process(filename="notes.pdf", content=b"%PDF fixture", model="gpt-6-astra")

    assert result.model == "gpt-6-astra"
    assert fake_responses.arguments["text_format"] is PdfTranscriptionPayload
    file_input = fake_responses.arguments["input"][0]["content"][0]
    assert file_input["type"] == "input_file"
    assert file_input["file_data"].startswith("data:application/pdf;base64,")


def test_pdf_model_endpoint_rejects_unknown_model():
    response = TestClient(app).post(
        "/v1/pdf-processing/transcriptions",
        files={"file": ("notes.pdf", b"%PDF-1.7 fixture", "application/pdf")},
        data={"provider": "development", "model": "made-up-model"},
    )

    assert response.status_code == 422
    assert "Unsupported development PDF model" in response.json()["detail"]
