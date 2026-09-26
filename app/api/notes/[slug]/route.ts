const API_BASE_URL = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const response = await fetch(`${API_BASE_URL}/notes/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      return Response.json({ error: payload.detail ?? "Published note not found." }, { status: response.status });
    }
    return Response.json(payload);
  } catch {
    return Response.json({ error: "The Python notes API is unavailable." }, { status: 503 });
  }
}
