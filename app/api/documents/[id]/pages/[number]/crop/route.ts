const API_BASE_URL = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

export async function GET(request: Request, context: { params: Promise<{ id: string; number: string }> }) {
  try {
    const { id, number } = await context.params;
    const query = new URL(request.url).searchParams;
    const response = await fetch(
      `${API_BASE_URL}/documents/${encodeURIComponent(id)}/pages/${encodeURIComponent(number)}/crop?${query}`,
      { cache: "no-store" },
    );
    if (!response.ok) return Response.json({ error: "Could not crop the source page." }, { status: response.status });
    return new Response(response.body, {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return Response.json({ error: "The Python API is unavailable." }, { status: 503 });
  }
}
