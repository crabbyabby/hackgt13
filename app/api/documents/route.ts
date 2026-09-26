const API_BASE_URL = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    console.info("[documents] Uploading source to Python document service…");
    const response = await fetch(`${API_BASE_URL}/documents`, { method: "POST", body: form });
    const payload = await response.json();
    console.info(`[documents] Upload response status=${response.status} document=${payload.id ?? "none"}`);
    if (!response.ok) {
      const detail = typeof payload?.detail === "string" ? payload.detail : payload?.detail?.message;
      return Response.json({ error: detail ?? "The Python document service rejected the upload." }, { status: response.status });
    }
    return Response.json(payload, { status: 202 });
  } catch (error) {
    console.error("[documents] Upload proxy failed", error);
    return Response.json({ error: "The Python API is unavailable. Start it with npm run api." }, { status: 503 });
  }
}
