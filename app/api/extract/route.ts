const API_BASE_URL = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

/** Thin browser-facing proxy. All extraction and document logic lives in Python. */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const response = await fetch(`${API_BASE_URL}/v1/extraction-jobs`, { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) {
      const detail = typeof payload?.detail === "string" ? payload.detail : payload?.detail?.message;
      return Response.json({ error: detail ?? "The Python extraction service rejected the upload." }, { status: response.status });
    }
    return Response.json(payload, { status: response.status });
  } catch {
    return Response.json({ error: "The Python API is unavailable. Start it with npm run api." }, { status: 503 });
  }
}
