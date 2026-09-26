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

## Current workflow

1. Upload a PDF or image, or open the development fixture.
2. Review semantic blocks, math notation, spoken math, and visual descriptions.
3. Generate a reader link.
4. Navigate, listen to, and download the accessible note.

## Architecture

The Python backend owns source validation, normalized page images, SQLite persistence, the extraction
pipeline, AI/document-processing boundaries, revisions, publication, and future voice sessions.
TypeScript is limited to the browser UI, polling transport, browser speech fallback, and thin API proxies.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for service boundaries, data flow, API routes, and the integration backlog.

## Configuration

Copy `.env.example` to `.env.local` when an integration is ready. Keep `EXTRACTION_PROVIDER=development`
for the local pipeline agents. The uploader automatically enables model choices for every configured
provider: `OPENAI_API_KEY` for OpenAI, `GEMINI_API_KEY` for Google Gemini, and `XAI_API_KEY` for Grok.
Choices without a configured key remain visible but disabled.

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
