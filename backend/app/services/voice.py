from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import httpx
from openai import AsyncOpenAI

from backend.app.domain.models import BlockKind, NoteBlock, SemanticNote


class VoiceProviderError(RuntimeError):
    pass


class VoiceProviderUnavailable(VoiceProviderError):
    pass


class ElevenLabsVoiceService:
    def __init__(
        self,
        *,
        api_key: str | None,
        voice_id: str,
        tts_model: str,
        stt_model: str,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.api_key = api_key
        self.voice_id = voice_id
        self.tts_model = tts_model
        self.stt_model = stt_model
        self.client = client

    def _require_key(self) -> str:
        if not self.api_key:
            raise VoiceProviderUnavailable("Configure ELEVENLABS_API_KEY in .env.local.")
        return self.api_key

    async def synthesize(self, text: str) -> bytes:
        api_key = self._require_key()
        request_client = self.client or httpx.AsyncClient(timeout=60)
        try:
            response = await request_client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}",
                params={"output_format": "mp3_44100_128"},
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json={
                    "text": text,
                    "model_id": self.tts_model,
                    "voice_settings": {"stability": 0.55, "similarity_boost": 0.75, "speed": 0.92},
                },
            )
            response.raise_for_status()
            return response.content
        except httpx.HTTPError as exc:
            raise VoiceProviderError(f"ElevenLabs speech generation failed: {exc}") from exc
        finally:
            if self.client is None:
                await request_client.aclose()

    async def transcribe(self, *, filename: str, content: bytes, content_type: str) -> dict:
        api_key = self._require_key()
        request_client = self.client or httpx.AsyncClient(timeout=90)
        try:
            response = await request_client.post(
                "https://api.elevenlabs.io/v1/speech-to-text",
                headers={"xi-api-key": api_key},
                files={"file": (filename, content, content_type)},
                data={"model_id": self.stt_model},
            )
            response.raise_for_status()
            payload = response.json()
            return {
                "text": payload.get("text", "").strip(),
                "languageCode": payload.get("language_code"),
                "languageProbability": payload.get("language_probability"),
            }
        except (httpx.HTTPError, ValueError) as exc:
            raise VoiceProviderError(f"ElevenLabs transcription failed: {exc}") from exc
        finally:
            if self.client is None:
                await request_client.aclose()

    async def create_agent_signed_url(self, agent_id: str | None) -> str:
        api_key = self._require_key()
        if not agent_id:
            raise VoiceProviderUnavailable("Configure ELEVENLABS_AGENT_ID in .env.local.")
        request_client = self.client or httpx.AsyncClient(timeout=30)
        try:
            response = await request_client.get(
                "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url",
                params={"agent_id": agent_id},
                headers={"xi-api-key": api_key},
            )
            response.raise_for_status()
            signed_url = response.json().get("signed_url")
            if not signed_url:
                raise VoiceProviderError("ElevenLabs returned no signed conversation URL.")
            return str(signed_url)
        except (httpx.HTTPError, ValueError) as exc:
            raise VoiceProviderError(f"ElevenLabs agent connection failed: {exc}") from exc
        finally:
            if self.client is None:
                await request_client.aclose()


class MathNarrationService:
    """Turns semantic notes into a literal, paced script before TTS synthesis."""

    def __init__(
        self,
        *,
        api_key: str | None,
        model: str,
        tts_model: str,
        client: Any | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.tts_model = tts_model
        self.client = client

    async def prepare(self, note: SemanticNote, block_index: int | None = None) -> str:
        blocks = note.blocks if block_index is None else [note.blocks[block_index]]
        fallback = self._fallback_script(note, blocks, include_title=block_index is None)
        if not self.api_key:
            return fallback

        pause = "[pause]" if self.tts_model == "eleven_v3" else '<break time="0.6s" />'
        scope = "the complete notes document" if block_index is None else "this single formula"
        source = "\n\n".join(self._block_source(block) for block in blocks)
        prompt = f"""Convert {scope} into a precise screen-reader narration script.

Rules:
- Return only the script that should be spoken. Never use Markdown or raw LaTeX.
- Preserve every statement, annotation, qualification, and mathematical relationship.
- Speak operators, grouping, fractions, roots, subscripts, matrices, and exponents explicitly.
- Insert {pause} at meaningful mathematical boundaries, especially before and after grouped terms.
- Say 2(x+1) as: two times {pause} open parenthesis x plus one close parenthesis.
- Say e^x as: e to the power of x.
- For a fraction, identify the numerator and denominator and pause between them.
- Do not solve, simplify, correct, or add facts that are absent from the notes.

Title: {note.title}

Semantic source:
{source}
"""
        try:
            client = self.client or AsyncOpenAI(api_key=self.api_key)
            response = await client.responses.create(model=self.model, input=prompt)
            script = response.output_text.strip()
            return script or fallback
        except Exception:  # noqa: BLE001 - narration remains available without the LLM provider
            return fallback

    def _fallback_script(
        self, note: SemanticNote, blocks: list[NoteBlock], *, include_title: bool
    ) -> str:
        parts = [note.title] if include_title else []
        for block in blocks:
            if block.title:
                parts.append(block.title)
            if block.text and (block.math is None or block.text != block.math.latex):
                parts.append(block.text)
            if block.math is not None:
                parts.append(self._paced_math(block.math.latex, block.math.spoken))
            if block.altText:
                parts.append(f"Visual description. {block.altText}")
        pause = "[pause]" if self.tts_model == "eleven_v3" else '<break time="0.6s" />'
        return f"\n\n{pause}\n\n".join(part for part in parts if part)

    @staticmethod
    def _block_source(block: NoteBlock) -> str:
        fields = [f"Type: {block.kind.value}"]
        if block.title:
            fields.append(f"Heading: {block.title}")
        if block.text:
            fields.append(f"Text: {block.text}")
        if block.math:
            fields.extend(
                [f"LaTeX: {block.math.latex}", f"Existing spoken form: {block.math.spoken}"]
            )
        if block.altText:
            fields.append(f"Visual description: {block.altText}")
        return "\n".join(fields)

    @staticmethod
    def _paced_math(latex: str, existing_spoken: str) -> str:
        value = latex.strip().strip("$")
        value = re.sub(
            r"([A-Za-z0-9}])\s*\(([^()]*)\)",
            r"\1 times [pause] open parenthesis \2 close parenthesis",
            value,
        )
        value = re.sub(
            r"([A-Za-z0-9}])\^\{([^{}]+)\}", r"\1 to the power of \2", value
        )
        value = re.sub(r"([A-Za-z0-9}])\^([A-Za-z0-9])", r"\1 to the power of \2", value)
        value = value.replace("+", " plus ").replace("-", " minus ").replace("=", " equals ")
        value = value.replace(r"\cdot", " times ").replace(r"\times", " times ")
        value = re.sub(r"\s+", " ", value).strip()
        if "\\" not in value and value != latex.strip().strip("$"):
            return value
        return existing_spoken


@dataclass(frozen=True, slots=True)
class NavigationResult:
    action: str
    index: int
    text: str | None
    message: str


class VoiceNavigationService:
    def resolve(self, *, note: SemanticNote, index: int, command: str) -> NavigationResult:
        if not note.blocks:
            return NavigationResult("none", 0, None, "This note has no readable items.")
        current_index = max(0, min(len(note.blocks) - 1, index))
        value = command.lower().strip()

        if re.search(r"\b(download|save)\b", value):
            return NavigationResult("download", current_index, None, "Downloading accessible HTML.")
        if re.search(
            r"\b(last|previous)\s+(formula|equation)\b|"
            r"\bgo back to (the )?(last|previous) (formula|equation)\b",
            value,
        ):
            target = self._find_previous_formula(note.blocks, current_index)
            if target is None:
                return NavigationResult("none", current_index, None, "There is no earlier formula.")
            return self._read(note, target, f"Returned to formula {target + 1}.")
        if re.search(r"\b(previous|go back one|move back one)\b", value):
            target = max(0, current_index - 1)
            return self._read(note, target, f"Moved to item {target + 1}.")
        if re.search(r"\b(next|continue|move forward)\b", value):
            target = min(len(note.blocks) - 1, current_index + 1)
            return self._read(note, target, f"Moved to item {target + 1}.")
        if "numerator" in value:
            return self._read_fraction_part(note, current_index, numerator=True)
        if "denominator" in value:
            return self._read_fraction_part(note, current_index, numerator=False)
        if re.search(r"\b(describe|diagram|graph|visual)\b", value):
            target = next(
                (
                    block_index
                    for block_index, block in enumerate(note.blocks)
                    if block.kind in {BlockKind.GRAPH, BlockKind.DIAGRAM}
                ),
                None,
            )
            if target is None:
                return NavigationResult("none", current_index, None, "No visual was found.")
            return self._read(note, target, f"Describing visual item {target + 1}.")
        if re.search(r"\b(again|repeat|read|listen|speak)\b", value):
            return self._read(note, current_index, f"Reading item {current_index + 1}.")
        return NavigationResult("none", current_index, None, f"Command not recognized: {command}")

    def _read(self, note: SemanticNote, index: int, message: str) -> NavigationResult:
        return NavigationResult("read", index, self._speech_for(note.blocks[index]), message)

    @staticmethod
    def _speech_for(block: NoteBlock) -> str:
        if block.math is not None:
            return block.math.spoken
        return block.altText or block.text

    @staticmethod
    def _find_previous_formula(blocks: list[NoteBlock], index: int) -> int | None:
        for candidate in range(index - 1, -1, -1):
            if blocks[candidate].math is not None or blocks[candidate].kind == BlockKind.EQUATION:
                return candidate
        return None

    def _read_fraction_part(
        self, note: SemanticNote, index: int, *, numerator: bool
    ) -> NavigationResult:
        target = index if note.blocks[index].math is not None else self._find_previous_formula(note.blocks, index + 1)
        if target is None or note.blocks[target].math is None:
            return NavigationResult("none", index, None, "Move to a fraction before requesting that part.")
        fraction = self._first_fraction(note.blocks[target].math.latex)
        part_name = "numerator" if numerator else "denominator"
        if fraction is None:
            return NavigationResult(
                "none", target, None, f"The current formula has no explicit fraction {part_name}."
            )
        selected = fraction[0] if numerator else fraction[1]
        spoken = self._latex_to_speech(selected)
        return NavigationResult(
            "read", target, f"The {part_name} is {spoken}.", f"Reading the {part_name}."
        )

    @classmethod
    def _first_fraction(cls, latex: str) -> tuple[str, str] | None:
        marker = latex.find(r"\frac")
        if marker < 0:
            return None
        numerator, next_position = cls._braced_value(latex, marker + len(r"\frac"))
        if numerator is None:
            return None
        denominator, _ = cls._braced_value(latex, next_position)
        if denominator is None:
            return None
        return numerator, denominator

    @staticmethod
    def _braced_value(value: str, position: int) -> tuple[str | None, int]:
        while position < len(value) and value[position].isspace():
            position += 1
        if position >= len(value) or value[position] != "{":
            return None, position
        depth = 0
        for current in range(position, len(value)):
            if value[current] == "{":
                depth += 1
            elif value[current] == "}":
                depth -= 1
                if depth == 0:
                    return value[position + 1 : current], current + 1
        return None, position

    @staticmethod
    def _latex_to_speech(value: str) -> str:
        replacements = {
            r"\lambda": " lambda ",
            r"\theta": " theta ",
            r"\pi": " pi ",
            r"\cdot": " times ",
            r"\times": " times ",
            "^2": " squared",
            "^3": " cubed",
            "_": " sub ",
        }
        spoken = value
        for source, replacement in replacements.items():
            spoken = spoken.replace(source, replacement)
        spoken = re.sub(r"[{}]", " ", spoken)
        spoken = re.sub(r"\\[a-zA-Z]+", " ", spoken)
        return re.sub(r"\s+", " ", spoken).strip()
