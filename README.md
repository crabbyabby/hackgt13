# EigenScribe

EigenScribe turns handwritten or static math notes into a reviewed semantic document, then publishes that document as an accessible interactive reader.

The merged architecture uses Mackenzie's durable document service for uploads, page preparation,
SQLite persistence, background processing, review revisions, retry, and finalization. Its converter
boundary calls the selectable OpenAI, Gemini, Grok, or deterministic development transcription adapter.

## Run locally

Requirements: Node.js 22.13 or newer.

Install both runtimes once:

```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -e '.[dev]'
```

Run the Python API in one terminal:

```bash
source .venv/bin/activate
npm run api
```

Run the browser app in another terminal:

```bash
npm run dev
```

Open <http://localhost:5173>. FastAPI documentation is available at <http://localhost:8000/docs>.

The API terminal logs every upload stage, model dispatch, ten-second wait
heartbeat, bounded partial result, schema conversion, narration request, and
provider fallback. Set `LOG_LEVEL=DEBUG` in `.env.local` for document-status
poll reads as well. `MODEL_PROGRESS_INTERVAL_SECONDS` controls the heartbeat.

## Current workflow

1. Upload a PDF or image, or open the development fixture.
2. Review semantic blocks, math notation, spoken math, and visual descriptions.
3. Generate a reader link.
4. Generate a full-note MP3, click a formula for paced math narration, start a
   real-time document-aware voice conversation, or download the accessible note.

## Architecture

The Python backend owns source validation, normalized page images, SQLite persistence, the extraction
pipeline, AI/document-processing boundaries, revisions, publication, narration preparation, and secure
voice-provider credentials. TypeScript is limited to the browser UI, polling transport, ElevenLabs'
real-time browser session, audio playback, and thin API proxies.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for service boundaries, data flow, API routes, and the integration backlog.

## Configuration

Copy `.env.example` to `.env.local` when an integration is ready. Keep `EXTRACTION_PROVIDER=development`
for the local pipeline agents. The uploader automatically enables model choices for every configured
provider: `OPENAI_API_KEY` for OpenAI, `GEMINI_API_KEY` for Google Gemini, and `XAI_API_KEY` for Grok.
Choices without a configured key remain visible but disabled.

Voice features use ElevenLabs while math narration preparation uses a text LLM.
Add these values to `.env.local`, then restart both servers:

```bash
ELEVENLABS_API_KEY=your_key
ELEVENLABS_AGENT_ID=your_agent_id
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
ELEVENLABS_TTS_MODEL=eleven_v3
ELEVENLABS_STT_MODEL=scribe_v2
NARRATION_MODEL=gpt-6-luna
```

The full-note and click-to-read modes use ElevenLabs when `ELEVENLABS_API_KEY`
is configured. Set `OPENAI_API_KEY` as well to have the narration LLM rewrite raw notation into an
explicit spoken script; otherwise the reviewed spoken-math fields are used as a
deterministic fallback. If ElevenLabs is unconfigured or its TTS request fails,
the reader automatically speaks the same math-aware script with the browser's
default `speechSynthesis` voice. This makes click-to-read formula testing work in
development mode without an ElevenLabs account. Real-time conversation additionally requires an
ElevenLabs Agent with prompt overrides enabled and its ID in
`ELEVENLABS_AGENT_ID`. The Python API creates the signed connection URL so the
ElevenLabs key is never sent to the browser.

The uploader uses the persisted `/documents` workflow. The lower-level transcription API remains
available for testing providers directly:

```bash
curl http://127.0.0.1:8000/v1/pdf-processing/models
curl -X POST http://127.0.0.1:8000/v1/pdf-processing/transcriptions \
  -F 'file=@/absolute/path/to/notes.pdf' \
  -F 'provider=openai' \
  -F 'model=gpt-6-sol'
```

The response preserves page order, literal text, equations, visual marks, bounding boxes, color/style,
relationships, review flags, and alternative interpretations. Confidence values are model-reported and
must be confirmed during instructor review.

## Useful commands

```bash
npm run api
npm run dev
npm run build
python3 -m pytest
```
