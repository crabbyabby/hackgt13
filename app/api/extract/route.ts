const API_BASE_URL = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

/** Thin browser-facing proxy. All extraction and document logic lives in Python. */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const uploadResponse = await fetch(`${API_BASE_URL}/documents`, { method: "POST", body: form });
    const accepted = await uploadResponse.json();
    if (!uploadResponse.ok) {
      const detail = typeof accepted?.detail === "string" ? accepted.detail : accepted?.detail?.message;
      return Response.json({ error: detail ?? "The Python document service rejected the upload." }, { status: uploadResponse.status });
    }

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const documentResponse = await fetch(`${API_BASE_URL}/documents/${accepted.id}`, { cache: "no-store" });
      const document = await documentResponse.json();
      if (!documentResponse.ok) return Response.json({ error: document.detail ?? "Could not read the document job." }, { status: documentResponse.status });
      if (document.status === "failed") return Response.json({ error: document.error ?? "Document processing failed." }, { status: 502 });
      if (document.status === "needs_review" || document.status === "ready") {
        const noteResponse = await fetch(`${API_BASE_URL}/documents/${accepted.id}/semantic-note`, { cache: "no-store" });
        const note = await noteResponse.json();
        if (!noteResponse.ok) return Response.json({ error: note.detail ?? "Could not compile the semantic note." }, { status: noteResponse.status });
        return Response.json({ job: { id: accepted.id, status: document.status }, note });
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return Response.json({ error: "Document processing is still running. Try again shortly." }, { status: 504 });
  } catch {
    return Response.json({ error: "The Python API is unavailable. Start it with npm run api." }, { status: 503 });
  }
}
