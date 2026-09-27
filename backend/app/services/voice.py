from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Any

import httpx
from openai import AsyncOpenAI

from backend.app.core.logging import preview
from backend.app.domain.models import BlockKind, NoteBlock, SemanticNote

logger = logging.getLogger("eigenscribe.voice")
PROGRESS_INTERVAL_SECONDS = float(os.getenv("MODEL_PROGRESS_INTERVAL_SECONDS", "10"))


class VoiceProviderError(RuntimeError):
    pass


class VoiceProviderUnavailable(VoiceProviderError):
    pass


TTS_CHAR_LIMIT = 14_000
GROK_PAUSE = "[pause]"


class PersistentVoiceCache:
    """Content-addressed cache for private narration scripts and generated audio."""

    def __init__(self, root: str | Path | None) -> None:
        self.root = Path(root).resolve() if root else None
        self._locks: dict[str, asyncio.Lock] = {}

    @staticmethod
    def key(namespace: str, payload: object) -> str:
        encoded = json.dumps(
            {"namespace": namespace, "payload": payload},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def lock(self, key: str) -> asyncio.Lock:
        return self._locks.setdefault(key, asyncio.Lock())

    def read_bytes(self, namespace: str, key: str, suffix: str) -> bytes | None:
        path = self._path(namespace, key, suffix)
        if path is None or not path.is_file():
            return None
        content = path.read_bytes()
        return content or None

    def write_bytes(self, namespace: str, key: str, suffix: str, content: bytes) -> None:
        path = self._path(namespace, key, suffix)
        if path is None or not content:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        temporary.write_bytes(content)
        os.replace(temporary, path)

    def read_text(self, namespace: str, key: str) -> str | None:
        content = self.read_bytes(namespace, key, ".txt")
        return content.decode("utf-8") if content else None

    def write_text(self, namespace: str, key: str, content: str) -> None:
        self.write_bytes(namespace, key, ".txt", content.encode("utf-8"))

    def _path(self, namespace: str, key: str, suffix: str) -> Path | None:
        if self.root is None:
            return None
        return self.root / namespace / f"{key}{suffix}"


class GrokVoiceService:
    """Grok text-to-speech, speech-to-text, and realtime session credentials."""

    def __init__(
        self,
        *,
        api_key: str | None,
        voice_id: str,
        language: str,
        realtime_model: str,
        client: httpx.AsyncClient | None = None,
        cache_dir: str | Path | None = None,
    ) -> None:
        self.api_key = api_key
        self.voice_id = voice_id
        self.language = language
        self.realtime_model = realtime_model
        self.client = client
        self.cache = PersistentVoiceCache(cache_dir)

    def _require_key(self) -> str:
        if not self.api_key:
            raise VoiceProviderUnavailable("Configure XAI_API_KEY in .env.local.")
        return self.api_key

    async def synthesize(self, text: str) -> bytes:
        cache_key = self.cache.key(
            "grok-tts-v1",
            {"text": text, "voice": self.voice_id, "language": self.language},
        )
        cached = self.cache.read_bytes("speech", cache_key, ".mp3")
        if cached is not None:
            logger.info("TTS cache hit | provider=grok key=%s bytes=%d", cache_key[:12], len(cached))
            return cached

        async with self.cache.lock(cache_key):
            cached = self.cache.read_bytes("speech", cache_key, ".mp3")
            if cached is not None:
                logger.info(
                    "TTS cache hit after wait | provider=grok key=%s bytes=%d",
                    cache_key[:12],
                    len(cached),
                )
                return cached
            return await self._synthesize_uncached(text, cache_key)

    async def _synthesize_uncached(self, text: str, cache_key: str) -> bytes:
        api_key = self._require_key()
        request_client = self.client or httpx.AsyncClient(timeout=90)
        chunks = self._speech_chunks(text)
        started = perf_counter()
        logger.info(
            "TTS start | provider=grok voice=%s language=%s chars=%d chunks=%d preview=%r",
            self.voice_id,
            self.language,
            len(text),
            len(chunks),
            preview(text),
        )
        audio = bytearray()
        try:
            for index, chunk in enumerate(chunks, start=1):
                logger.info("TTS waiting for Grok response | chunk=%d/%d", index, len(chunks))
                response = await request_client.post(
                    "https://api.x.ai/v1/tts",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={"text": chunk, "voice_id": self.voice_id, "language": self.language},
                )
                if response.is_error:
                    raise VoiceProviderError(
                        f"Grok speech generation failed ({response.status_code}): {response.text[:300]}"
                    )
                audio.extend(response.content)
            logger.info(
                "TTS complete | bytes=%d elapsed=%.2fs content_type=%s",
                len(audio),
                perf_counter() - started,
                "audio/mpeg",
            )
            result = bytes(audio)
            self.cache.write_bytes("speech", cache_key, ".mp3", result)
            logger.info("TTS cache stored | provider=grok key=%s", cache_key[:12])
            return result
        except httpx.HTTPError as exc:
            logger.exception("TTS failed after %.2fs", perf_counter() - started)
            raise VoiceProviderError(f"Grok speech generation failed: {exc}") from exc
        finally:
            if self.client is None:
                await request_client.aclose()

    async def transcribe(self, *, filename: str, content: bytes, content_type: str) -> dict:
        api_key = self._require_key()
        request_client = self.client or httpx.AsyncClient(timeout=90)
        started = perf_counter()
        logger.info(
            "STT start | provider=grok file=%r bytes=%d content_type=%s",
            filename,
            len(content),
            content_type,
        )
        try:
            logger.info("STT waiting for Grok transcription…")
            response = await request_client.post(
                "https://api.x.ai/v1/stt",
                headers={"Authorization": f"Bearer {api_key}"},
                data={"language": self.language, "format": "true"},
                files={"file": (filename, content, content_type)},
            )
            if response.is_error:
                raise VoiceProviderError(
                    f"Grok transcription failed ({response.status_code}): {response.text[:300]}"
                )
            payload = response.json()
            logger.info(
                "STT complete | elapsed=%.2fs language=%s partial_result=%r",
                perf_counter() - started,
                payload.get("language", "unknown"),
                preview(payload.get("text", "")),
            )
            return {
                "text": payload.get("text", "").strip(),
                "languageCode": payload.get("language"),
            }
        except VoiceProviderError:
            raise
        except (httpx.HTTPError, ValueError) as exc:
            logger.exception("STT failed after %.2fs", perf_counter() - started)
            raise VoiceProviderError(f"Grok transcription failed: {exc}") from exc
        finally:
            if self.client is None:
                await request_client.aclose()

    async def create_realtime_session(self) -> dict[str, Any]:
        api_key = self._require_key()
        request_client = self.client or httpx.AsyncClient(timeout=30)
        started = perf_counter()
        logger.info(
            "Voice session start | provider=grok model=%s voice=%s", self.realtime_model, self.voice_id
        )
        try:
            logger.info("Voice session waiting for Grok client secret…")
            response = await request_client.post(
                "https://api.x.ai/v1/realtime/client_secrets",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"expires_after": {"seconds": 600}},
            )
            if response.is_error:
                raise VoiceProviderError(
                    f"Grok voice session failed ({response.status_code}): {response.text[:300]}"
                )
            payload = response.json()
            token = payload.get("value")
            if not token:
                raise VoiceProviderError("Grok returned no realtime client secret.")
            logger.info("Voice session ready | elapsed=%.2fs", perf_counter() - started)
            return {
                "token": str(token),
                "expiresAt": payload.get("expires_at"),
                "url": f"wss://api.x.ai/v1/realtime?model={self.realtime_model}",
                "voice": self.voice_id,
            }
        except VoiceProviderError:
            raise
        except (httpx.HTTPError, ValueError) as exc:
            logger.exception("Voice session failed after %.2fs", perf_counter() - started)
            raise VoiceProviderError(f"Grok voice session failed: {exc}") from exc
        finally:
            if self.client is None:
                await request_client.aclose()

    @staticmethod
    def _speech_chunks(text: str) -> list[str]:
        remaining = text.strip()
        if not remaining:
            raise VoiceProviderError("The narration script is empty.")
        chunks: list[str] = []
        while remaining:
            if len(remaining) <= TTS_CHAR_LIMIT:
                chunks.append(remaining)
                break
            split_at = remaining.rfind("\n\n", 0, TTS_CHAR_LIMIT)
            if split_at < TTS_CHAR_LIMIT // 2:
                split_at = remaining.rfind(" ", 0, TTS_CHAR_LIMIT)
            if split_at < 1:
                split_at = TTS_CHAR_LIMIT
            chunks.append(remaining[:split_at].strip())
            remaining = remaining[split_at:].strip()
        return chunks


class MathNarrationService:
    """Turns semantic notes into a literal, paced script before TTS synthesis."""

    def __init__(
        self,
        *,
        api_key: str | None,
        model: str,
        client: Any | None = None,
        cache_dir: str | Path | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.client = client
        self.cache = PersistentVoiceCache(cache_dir)

    async def prepare(self, note: SemanticNote, block_index: int | None = None) -> str:
        blocks = note.blocks if block_index is None else [note.blocks[block_index]]
        fallback = self._fallback_script(note, blocks, include_title=block_index is None)
        scope = "full-note" if block_index is None else f"formula-block-{block_index}"
        logger.info(
            "Narration script start | note=%s scope=%s blocks=%d fallback_preview=%r",
            note.id,
            scope,
            len(blocks),
            preview(fallback),
        )
        if not self.api_key:
            logger.info("Narration LLM unavailable; returning deterministic script | scope=%s", scope)
            return fallback

        prompt_scope = "the complete notes document" if block_index is None else "this single formula"
        source = "\n\n".join(self._block_source(block) for block in blocks)
        prompt = f"""Convert {prompt_scope} into a precise screen-reader narration script.

Rules:
- Return only the script that should be spoken. Never use Markdown or raw LaTeX.
- Preserve every statement, annotation, qualification, and mathematical relationship.
- Speak operators, grouping, fractions, roots, subscripts, matrices, and exponents explicitly.
- Insert {GROK_PAUSE} at meaningful mathematical boundaries, especially before and after grouped terms.
- Say 2(x+1) as: two times {GROK_PAUSE} open parenthesis x plus one close parenthesis.
- Say e^x as: e to the power of x.
- For a fraction, identify the numerator and denominator and pause between them.
- Do not solve, simplify, correct, or add facts that are absent from the notes.

Title: {note.title}

Semantic source:
{source}
"""
        cache_key = self.cache.key(
            "math-narration-v1",
            {
                "model": self.model,
                "scope": prompt_scope,
                "title": note.title,
                "source": source,
            },
        )
        cached = self.cache.read_text("narration", cache_key)
        if cached is not None:
            logger.info(
                "Narration cache hit | model=%s scope=%s key=%s chars=%d",
                self.model,
                scope,
                cache_key[:12],
                len(cached),
            )
            return cached

        async with self.cache.lock(cache_key):
            cached = self.cache.read_text("narration", cache_key)
            if cached is not None:
                logger.info(
                    "Narration cache hit after wait | model=%s scope=%s key=%s chars=%d",
                    self.model,
                    scope,
                    cache_key[:12],
                    len(cached),
                )
                return cached
            return await self._prepare_uncached(
                prompt=prompt,
                source=source,
                scope=scope,
                fallback=fallback,
                cache_key=cache_key,
            )

    async def _prepare_uncached(
        self,
        *,
        prompt: str,
        source: str,
        scope: str,
        fallback: str,
        cache_key: str,
    ) -> str:
        started = perf_counter()
        try:
            client = self.client or AsyncOpenAI(api_key=self.api_key)
            logger.info(
                "Narration LLM request sent | model=%s scope=%s source_chars=%d; waiting for model…",
                self.model,
                scope,
                len(source),
            )
            task = asyncio.create_task(client.responses.create(model=self.model, input=prompt))
            while not task.done():
                done, _ = await asyncio.wait({task}, timeout=PROGRESS_INTERVAL_SECONDS)
                if task not in done:
                    logger.info(
                        "Narration LLM still processing | model=%s scope=%s elapsed=%.1fs",
                        self.model,
                        scope,
                        perf_counter() - started,
                    )
            response = await task
            script = response.output_text.strip()
            logger.info(
                "Narration LLM complete | scope=%s elapsed=%.2fs chars=%d partial_result=%r",
                scope,
                perf_counter() - started,
                len(script),
                preview(script),
            )
            if not script:
                return fallback
            self.cache.write_text("narration", cache_key, script)
            logger.info("Narration cache stored | model=%s key=%s", self.model, cache_key[:12])
            return script
        except Exception:
            logger.exception(
                "Narration LLM failed after %.2fs; using deterministic script | scope=%s",
                perf_counter() - started,
                scope,
            )
            return fallback

    def _fallback_script(self, note: SemanticNote, blocks: list[NoteBlock], *, include_title: bool) -> str:
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
        return f"\n\n{GROK_PAUSE}\n\n".join(part for part in parts if part)

    @staticmethod
    def _block_source(block: NoteBlock) -> str:
        fields = [f"Type: {block.kind.value}"]
        if block.title:
            fields.append(f"Heading: {block.title}")
        if block.text:
            fields.append(f"Text: {block.text}")
        if block.math:
            fields.extend([f"LaTeX: {block.math.latex}", f"Existing spoken form: {block.math.spoken}"])
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
        value = re.sub(r"([A-Za-z0-9}])\^\{([^{}]+)\}", r"\1 to the power of \2", value)
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
        logger.info(
            "Navigation command | note=%s index=%d command=%r",
            note.id,
            index,
            preview(command, 160),
        )
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

    def _read_fraction_part(self, note: SemanticNote, index: int, *, numerator: bool) -> NavigationResult:
        target = (
            index
            if note.blocks[index].math is not None
            else self._find_previous_formula(note.blocks, index + 1)
        )
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
        return NavigationResult("read", target, f"The {part_name} is {spoken}.", f"Reading the {part_name}.")

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
