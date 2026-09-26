const API_BASE_URL = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const response = await fetch(`${API_BASE_URL}/documents/${encodeURIComponent(id)}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      return Response.json({ error: payload.detail ?? "Could not read the document job." }, { status: response.status });
    }
    return Response.json(payload);
  } catch (error) {
    console.error("[documents] Status proxy failed", error);
    return Response.json({ error: "The Python API is unavailable." }, { status: 503 });
  }
}
