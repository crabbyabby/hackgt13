import json
from types import SimpleNamespace

import httpx

from backend.app.domain.models import BlockKind, MathNode, NoteBlock, NoteSource, SemanticNote, SourceKind
from backend.app.services.voice import GrokVoiceService, MathNarrationService


def note_fixture() -> SemanticNote:
    return SemanticNote(
        slug="calculus",
        title="Calculus notes",
        source=NoteSource(name="notes.pdf", kind=SourceKind.PDF, pageCount=1),
        blocks=[
            NoteBlock(
                kind=BlockKind.PARAGRAPH,
                text="Apply the chain rule.",
                confidence=1,
                needsReview=False,
            ),
            NoteBlock(
                kind=BlockKind.EQUATION,
                text="A grouped product equals an exponential.",
                math=MathNode(
                    latex="2(x+1)=e^x",
                    spoken="two times open parenthesis x plus one close parenthesis equals e to the power of x",
                    label="Example",
                ),
                confidence=1,
                needsReview=False,
            ),
        ],
    )


async def test_formula_fallback_adds_explicit_math_and_pause():
    service = MathNarrationService(api_key=None, model="unused")

    script = await service.prepare(note_fixture(), block_index=1)

    assert "2 times [pause] open parenthesis x plus 1 close parenthesis" in script
    assert "e to the power of x" in script


async def test_full_note_narration_uses_text_llm_when_configured():
    class Responses:
        async def create(self, **kwargs):
            assert kwargs["model"] == "narrator-model"
            assert "Apply the chain rule" in kwargs["input"]
            return SimpleNamespace(output_text="Prepared accessible narration.")

    service = MathNarrationService(
        api_key="test-openai-key",
        model="narrator-model",
        client=SimpleNamespace(responses=Responses()),
    )

    assert await service.prepare(note_fixture()) == "Prepared accessible narration."


async def test_grok_tts_stt_and_realtime_session_requests():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/realtime/client_secrets"):
            return httpx.Response(
                200,
                json={"value": "xai-realtime-client-secret-test", "expires_at": 1750000000},
            )
        if request.url.path.endswith("/stt"):
            return httpx.Response(200, json={"text": "read the numerator", "language": "en"})
        body = json.loads(request.content)
        assert body == {"text": "hello", "voice_id": "eve", "language": "en"}
        return httpx.Response(200, content=b"mp3-data")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service = GrokVoiceService(
            api_key="test-xai-key",
            voice_id="eve",
            language="en",
            realtime_model="grok-voice-latest",
            client=client,
        )
        assert await service.synthesize("hello") == b"mp3-data"
        transcript = await service.transcribe(
            filename="command.webm",
            content=b"audio",
            content_type="audio/webm",
        )
        session = await service.create_realtime_session()

    assert transcript == {"text": "read the numerator", "languageCode": "en"}
    assert session["token"] == "xai-realtime-client-secret-test"
    assert session["url"] == "wss://api.x.ai/v1/realtime?model=grok-voice-latest"
    assert session["voice"] == "eve"
    assert all(request.headers["authorization"] == "Bearer test-xai-key" for request in requests)
    assert requests[0].url.path == "/v1/tts"
    assert requests[1].url.path == "/v1/stt"
    assert requests[2].url.path == "/v1/realtime/client_secrets"
