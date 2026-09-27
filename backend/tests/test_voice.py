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


async def test_full_note_narration_uses_text_llm_once_then_persistent_cache(tmp_path):
    calls = 0

    class Responses:
        async def create(self, **kwargs):
            nonlocal calls
            calls += 1
            assert kwargs["model"] == "narrator-model"
            assert "Apply the chain rule" in kwargs["input"]
            return SimpleNamespace(output_text="Prepared accessible narration.")

    service = MathNarrationService(
        api_key="test-openai-key",
        model="narrator-model",
        client=SimpleNamespace(responses=Responses()),
        cache_dir=tmp_path / "voice-cache",
    )

    assert await service.prepare(note_fixture()) == "Prepared accessible narration."

    restarted_service = MathNarrationService(
        api_key="test-openai-key",
        model="narrator-model",
        client=SimpleNamespace(responses=Responses()),
        cache_dir=tmp_path / "voice-cache",
    )
    assert await restarted_service.prepare(note_fixture()) == "Prepared accessible narration."
    assert calls == 1


async def test_grok_tts_stt_and_realtime_session_requests(tmp_path):
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
            formula_voice_id="luna",
            language="en",
            realtime_model="grok-voice-latest",
            client=client,
            cache_dir=tmp_path / "voice-cache",
        )
        assert await service.synthesize("hello") == b"mp3-data"
        restarted_service = GrokVoiceService(
            api_key="test-xai-key",
            voice_id="eve",
            formula_voice_id="luna",
            language="en",
            realtime_model="grok-voice-latest",
            client=client,
            cache_dir=tmp_path / "voice-cache",
        )
        assert await restarted_service.synthesize("hello") == b"mp3-data"
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
    assert sum(request.url.path == "/v1/tts" for request in requests) == 1


async def test_full_reading_uses_two_voices_then_reuses_composite_cache(tmp_path):
    requests: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append(body)
        return httpx.Response(200, content=f"audio-{body['voice_id']}".encode())

    cache_dir = tmp_path / "voice-cache"
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service = GrokVoiceService(
            api_key="test-xai-key",
            voice_id="eve",
            formula_voice_id="luna",
            language="en",
            realtime_model="grok-voice-latest",
            client=client,
            cache_dir=cache_dir,
        )
        segments = MathNarrationService(api_key=None, model="unused").reading_segments(note_fixture())
        first = await service.synthesize_reading(segments)

        restarted = GrokVoiceService(
            api_key="test-xai-key",
            voice_id="eve",
            formula_voice_id="luna",
            language="en",
            realtime_model="grok-voice-latest",
            client=client,
            cache_dir=cache_dir,
        )
        second = await restarted.synthesize_reading(segments)

    assert first == second == b"audio-eveaudio-luna"
    assert [request["voice_id"] for request in requests] == ["eve", "luna"]


async def test_graph_and_reader_intro_use_distinct_persistent_voice_cache(tmp_path):
    requests: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append(body)
        return httpx.Response(200, content=f"audio-{body['voice_id']}".encode())

    cache_dir = tmp_path / "voice-cache"
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service = GrokVoiceService(
            api_key="test-xai-key",
            voice_id="eve",
            formula_voice_id="luna",
            visual_voice_id="ara",
            language="en",
            realtime_model="grok-voice-latest",
            client=client,
            cache_dir=cache_dir,
        )
        graph_audio = await service.synthesize_visual_description("A parabola opens upward.")
        intro_audio = await service.synthesize_reader_onboarding()

        restarted = GrokVoiceService(
            api_key="test-xai-key",
            voice_id="eve",
            formula_voice_id="luna",
            visual_voice_id="ara",
            language="en",
            realtime_model="grok-voice-latest",
            client=client,
            cache_dir=cache_dir,
        )
        assert await restarted.synthesize_visual_description("A parabola opens upward.") == graph_audio
        assert await restarted.synthesize_reader_onboarding() == intro_audio

    assert graph_audio == b"audio-ara"
    assert intro_audio == b"audio-eve"
    assert [request["voice_id"] for request in requests] == ["ara", "eve"]
