# EigenScribe architecture

## Core design rule

Every feature operates on one versioned semantic document. OCR text, LaTeX, spoken math, graph descriptions, source coordinates, confidence, and human corrections belong to that document. The interactive reader is a renderer, not another extraction pipeline.

```text
PDF / image
    │
    ▼
Source storage ──► loss-aware PDF transcription ──► semantic extraction job
    │                     │                              │
    │                     ├─► verbatim regions          ▼
    │                     ├─► interpretation options  page normalization ──► layout + reading order
    │                     └─► confidence + review        │
    │                                                    │
    │                                                    ├─► math structure
    │                                                    ├─► graphs / diagrams
    │                                                    └─► notes / color / emphasis
    │
    ▼
SemanticNote draft ──► human review ──► immutable publication revision
                                              │
                         ┌────────────────────┼────────────────────┐
                         ▼                    ▼                    ▼
                  web reader           accessible file       voice agent
```

## Project boundaries

```text
backend/app/
  api/routes/             FastAPI transport only
  document_processing/    loss-aware PDF/handwriting transcription
  domain/                 Pydantic models and pipeline data
  ports/                  agent and repository interfaces
  adapters/               development fixtures and integration TODOs
  services/               extraction, publication, and voice use cases
app/
  api/extract/            thin proxy to the Python API
  review/                 minimal reviewer UI
  notes/[slug]/           accessible reader UI
components/               UI components; no provider logic
lib/domain/               canonical types and browser draft helper
lib/voice/                browser command parser only
docs/                     architecture and decisions
```

Dependencies point inward: FastAPI routes depend on Python services, services depend on ports and Pydantic domain models, and integrations implement those ports. Domain models do not import FastAPI, database, or model-provider code. TypeScript never performs extraction, document parsing, AI calls, or publication logic.

## Canonical document

`SemanticNote` contains ordered `NoteBlock` objects. A block can be a heading, paragraph, equation, graph, diagram, or annotation. Blocks carry confidence and `needsReview`; math blocks can carry LaTeX, spoken math, labels, and variable meanings; visual blocks can carry alt text and source-page coordinates.

The current type is intentionally compact. Before persistence, add:

- document and block schema versions;
- immutable publication revisions;
- mathematical expression trees for structural navigation;
- relationships between annotations and their targets;
- graph/diagram object models and data series;
- audit metadata for model output and human corrections.

## Backend services

### ExtractionService

Owns upload validation and extraction orchestration. Today it invokes a provider synchronously. The production version should enqueue a job and let a worker execute bounded stages with progress events.

Proposed production stages:

1. Ingest: malware scan, MIME verification, page split, rotation, source storage.
2. Layout: page regions, reading order, headings, colors, arrows, and annotations.
3. Math: expressions, aligned derivations, matrices, symbols, and spoken forms.
4. Visuals: graph/diagram detection, labels, relationships, and alt descriptions.
5. Reconcile: compare agents, surrounding context, notation history, and confidence.
6. Accessibility compile: normalize the final `SemanticNote` and flag review items.

### PublicationService

Validates a reviewed note and creates an immutable publication revision. It will eventually render semantic HTML/MathML, downloadable formats, cached narration segments, and a stable reader URL.

### VoiceSessionService

Creates a short-lived browser voice session. The model must call reader tools rather than directly manipulating UI state. Initial tools should be `read_current`, `read_again`, `next`, `previous`, `enter_child`, `go_parent`, `read_numerator`, `read_denominator`, `read_row`, and `read_column`.

### Repositories

The development store is in-memory and intentionally disposable. Production should use:

- object storage for original uploads, rendered page images, and generated downloads;
- a relational database for documents, jobs, blocks, review revisions, and publications;
- a queue for extraction jobs;
- append-only audit records for provider and reviewer changes.

## API surface

| Route | Purpose | Current state |
| --- | --- | --- |
| `POST /api/extract` | TypeScript browser proxy to FastAPI | Working |
| `POST /v1/extraction-jobs` | Create and currently execute an extraction job | Python development pipeline works |
| `GET /v1/extraction-jobs/:id` | Read extraction progress | Python in-memory repository |
| `GET /v1/pdf-processing/models` | List provider/model choices and API-key availability | Working |
| `POST /v1/pdf-processing/transcriptions` | Produce pre-semantic, ambiguity-preserving transcription | Development, OpenAI, Gemini, or Grok |
| `GET /v1/notes/:slug` | Read a semantic note | Python in-memory repository |
| `PUT /v1/notes/:slug` | Save reviewer corrections | Python; needs authorization |
| `POST /v1/notes/:slug/publish` | Create a publication | Python development implementation |
| `POST /v1/voice/sessions` | Create ephemeral realtime session | Python explicit 501 TODO |

## Integration TODOs

### Extraction

- Connect the loss-aware PDF transcription result to the semantic extraction agents.
- Add specialized fallbacks for low-confidence handwriting and math OCR.
- Rasterize PDFs deterministically and retain source coordinates.
- Add graph/diagram analysis with object-level descriptions.
- Validate every provider response against a versioned runtime schema.

### Jobs and storage

- Add durable object storage and relational migrations.
- Change upload to direct-to-object-storage for large files.
- Add queue workers, retry policy, idempotency keys, cancellation, and progress events.
- Add ownership, authorization, retention, export, and deletion policies.

### Review and publication

- Add optimistic concurrency and revision history.
- Require explicit acceptance of unresolved low-confidence blocks.
- Compile semantic HTML with MathML and run automated accessibility checks.
- Generate downloadable HTML, tagged PDF, and LMS-friendly packages.

### Voice

- Create ephemeral Realtime credentials server-side and connect over WebRTC.
- Expose semantic navigation as tools with cursor state owned by the application.
- Add captions, barge-in, replay, rate controls, and graceful text-only fallback.
- Cache stable narration while keeping navigation commands realtime.

### Operations

- Add structured logs, traces, model/version metadata, token and latency metrics.
- Add golden-note extraction evaluations and accessibility regression tests.
- Add moderation, abuse limits, upload scanning, and privacy controls.

## Deliberate non-decisions

This pass does not choose a final database, queue, OCR vendor, math parser, TTS voice, or authentication model. Those decisions sit behind interfaces so they can be evaluated with real professor notes before becoming architectural commitments.
