from types import SimpleNamespace

import httpx

from backend.app.domain.models import BlockKind, MathNode, NoteBlock, NoteSource, SemanticNote, SourceKind
from backend.app.services.voice import ElevenLabsVoiceService, MathNarrationService


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
    service = MathNarrationService(
        api_key=None,
        model="unused",
        tts_model="eleven_v3",
    )

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
        tts_model="eleven_v3",
        client=SimpleNamespace(responses=Responses()),
    )

    assert await service.prepare(note_fixture()) == "Prepared accessible narration."


async def test_elevenlabs_tts_stt_and_agent_url_requests():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("get-signed-url"):
            return httpx.Response(200, json={"signed_url": "wss://example.test/conversation"})
        if request.url.path.endswith("speech-to-text"):
            return httpx.Response(
                200,
                json={"text": "read the numerator", "language_code": "en"},
            )
        return httpx.Response(200, content=b"mp3-data")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service = ElevenLabsVoiceService(
            api_key="test-elevenlabs-key",
            voice_id="voice-id",
            tts_model="eleven_v3",
            stt_model="scribe_v2",
            client=client,
        )
        assert await service.synthesize("hello") == b"mp3-data"
        transcript = await service.transcribe(
            filename="command.webm",
            content=b"audio",
            content_type="audio/webm",
        )
        signed_url = await service.create_agent_signed_url("agent-id")

    assert transcript["text"] == "read the numerator"
    assert signed_url == "wss://example.test/conversation"
    assert all(request.headers["xi-api-key"] == "test-elevenlabs-key" for request in requests)
    assert requests[0].url.path == "/v1/text-to-speech/voice-id"
    assert requests[2].url.params["agent_id"] == "agent-id"
