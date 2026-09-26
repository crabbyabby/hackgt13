# The converter contract

```python
def convert_pages(
    page_images: list[str],
    *,
    provider: str = "development",
    model: str = "development-fixture",
) -> dict:
    ...
```

- Called once with all page images in source order (maximum 3 in this prototype).
- Paths are absolute; images exist locally and are normalized PNG files.
- Return a Python dictionary, not a JSON string, coroutine, or HTTP response.
- Raise an exception when conversion fails. Do not return partial output as success.
- No uploads, database writes, or server routes inside the converter.
- Use finite timeouts for external API requests.

Minimum example:

```json
{
  "title": "Pythagorean theorem",
  "blocks": [
    {
      "id": "block-001",
      "type": "equation",
      "page": 1,
      "text": "",
      "latex": "x^2 + y^2 = z^2",
      "description": "",
      "spokenText": "x squared plus y squared equals z squared",
      "needsReview": false,
      "reviewReason": ""
    }
  ]
}
```

Block types: heading, paragraph, equation, diagram.
The blocks array defines reading order. IDs are unique nonempty strings.
page is a one-based integer within the actual page count.
The appropriate content field and spokenText must be nonempty.
needsReview is a boolean, never a string. If true, reviewReason is required.
False means no uncertainty was flagged; it does not mean instructor approval.
No HTML generation in the converter. The reader renders text as text and uses
its math renderer for LaTeX. Diagram source pages stay available; cropping and
bounding boxes are outside this contract.

A full Person 1 envelope (id/status/pages/revision + title/blocks) also works.
Backend discards that envelope metadata and keeps its own ID and page URLs.
Extra fields inside blocks are rejected, to expose accidental schema drift.
Coordinate any block-schema changes with all four teammates first.

## Frontend example

```javascript
const API = 'http://127.0.0.1:8000';
const form = new FormData();
form.append('file', fileInput.files[0]);
const upload = await fetch(`${API}/documents`, { method: 'POST', body: form });
if (!upload.ok) throw new Error(await upload.text());
const { id } = await upload.json();
// Poll this endpoint about once per second until status is not processing.
const response = await fetch(`${API}/documents/${id}`);
const doc = await response.json();
// new URL(doc.pages[0].imageUrl, API).href resolves the page image URL.
```

To save edits, send title + all blocks + expectedRevision. Preserve block IDs,
update narration for changed content, and clear uncertainty flags after review.
A successful edit returns the complete document with its new revision.
A 409 requires re-fetching and reconciling edits before trying again.

```javascript
const saved = await fetch(`${API}/documents/${id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    expectedRevision: doc.revision,
    title: editedTitle,
    blocks: editedBlocks
  })
});
```

Statuses: processing -> needs_review -> ready; failures -> failed.
Retry: failed -> processing. Editing a ready document -> needs_review.
Full document responses always include error (null unless failed).
Use document revision in narration/audio cache keys to avoid stale playback.
