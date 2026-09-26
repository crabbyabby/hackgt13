# EigenScribe — Person 2 backend

A local hackathon backend with one replaceable converter function. No API key is
needed: the included converter returns clearly labeled mock text, not a transcription.

## Start on Windows (PowerShell)
Extract the ZIP, open this folder in VS Code, then open a terminal here:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

No environment activation or PowerShell execution-policy changes are required.
Use Python 3.11 or 3.12 for this starter (tested with Python 3.12).

Open http://127.0.0.1:8000/docs to test the endpoints without a frontend.

macOS/Linux:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --reload
```

## Your first five minutes
1. At /docs expand POST /documents and click Try it out.
2. Choose a PNG/JPEG or a PDF of 1–3 pages and click Execute.
3. Copy the returned id. A 202 response means accepted, not converted yet.
4. Run GET /documents/{doc_id} with that ID. Poll until status changes from
   processing to needs_review or failed.
5. A successful result contains mock blocks plus URLs for the original and page images.
6. Stop/restart the server and retrieve the same ID: documents persist.

## Project map
- app/main.py: routes, job orchestration, edits, and review lifecycle.
- app/converter.py: THE BLACK BOX integration point; replace only convert_pages.
- app/models.py: shared JSON validation and edit requests.
- app/pages.py: PDF rendering / image normalization.
- app/storage.py: SQLite persistence and revision-safe updates.
- CONTRACT.md: handoff agreement for your friend and frontend teammates.
- tests/test_api.py: integration tests, with no external API calls.
- data/: generated at runtime, excluded from Git and this ZIP.

## Connect your friend's converter
Replace the mock body in app/converter.py, or import her function there:

```python
from .person1.convert import convert_pages
```

Put her module and any supporting files in the matching folder; install her
requirements separately. The backend calls it exactly once per processing attempt:

```python
result = convert_pages(page_images)
```

Input is a list of absolute local PNG paths in page order. Output is a dictionary
with title and blocks (see CONTRACT.md). Additional top-level fields in her
existing document envelope are ignored: backend owns document identity and status.
Do not rename her function or add HTTP code inside it. Backend invocation runs
in a background thread. A converter exception or invalid result becomes failed.
If her code calls an AI provider, set that provider's key in the server terminal.
No AI key or SDK is needed for the mock. A .env file is not auto-loaded.

## API
| Method | Path | Purpose |
|---|---|---|
| GET | /health | Check server |
| POST | /documents | Multipart upload with file field; returns 202 |
| GET | /documents | Latest 100 document summaries |
| GET | /documents/{id} | Poll status or retrieve saved document |
| GET | /documents/{id}/source | Original uploaded file |
| GET | /documents/{id}/pages/{number} | Normalized PNG page |
| PATCH | /documents/{id} | Replace title + complete ordered blocks array |
| POST | /documents/{id}/finalize | Mark reviewed document ready |
| POST | /documents/{id}/retry | Retry a failed document |

On PATCH, supply expectedRevision from the latest GET. IDs must be preserved;
reordering is supported, adding/deleting blocks is not implemented. Update
spokenText alongside changed text/LaTeX/description. This prevents blindly
retaining old narration; a human still needs to check its accuracy. Any edit
moves a ready document back to needs_review.

Finalize/retry body: {"expectedRevision": 2} (use the current value, not always 2).
Finalize requires all block needsReview flags cleared by the editor. A conflicting
revision returns 409 so one person's save does not overwrite another's edits.

The mock flags every block. Resolve flags only after review; clearing them is a
useful lifecycle test but does not turn mock text into a real transcription.

## Persistence and frontend configuration
SQLite stores documents; local files store originals and prepared pages.
Default location: data/ relative to the directory you launch the server from.
Optional PowerShell settings before starting:

```powershell
$env:EIGENSCRIBE_DATA_DIR = 'C:\eigenscribe-data'
$env:FRONTEND_ORIGINS = 'http://localhost:5173,http://localhost:3000'
```

Returned sourceUrl/imageUrl values are relative to the backend origin. The
frontend should resolve them against http://127.0.0.1:8000, not its own origin.
Audio cache keys should include document ID + revision + block ID. This backend
does not store audio or regenerate narration; edited spokenText is supplied by
the review interface. HTML export remains Person 4's responsibility.

## Test

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Nine integration tests cover image uploads, PDF page order, stored edits,
revision conflicts, finalize/reopen, input limits, failure/retry, invalid converter
output, persistence, restart recovery, and stale narration checks. A test-client
deprecation warning may appear from Starlette; the tested HTTPX interface works.
TestClient waits for background work; a real browser receives 202 before completion.

## Scope and limits
This is a local single-process prototype, not an authenticated public service.
Run exactly one Uvicorn worker. Background jobs are in-process; on restart,
interrupted documents become failed and can be retried. A hanging converter
needs its own API timeout. File limit is 10 MiB; images are limited to 20 million
pixels, resized to a maximum 2000-pixel side, and PDFs to 3 pages. Smaller symbols
can lose detail after resizing: compare transcription against the original.

The app has no accounts or access control. Anyone with network access to this
server could read/edit its documents. Keep it bound to localhost for now.
Hosting later needs access control, persistent storage, a durable job queue,
and server-level upload limits.

## Implementation references
- https://fastapi.tiangolo.com/tutorial/request-files/
- https://fastapi.tiangolo.com/tutorial/background-tasks/
- https://pymupdf.readthedocs.io/en/latest/recipes-images.html
