const API_BASE_URL = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

export async function GET() {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/voice/onboarding`, { cache: "no-store" });
    if (!response.ok) return Response.json({ error: "Grok onboarding voice is unavailable." }, { status: response.status });
    return new Response(response.body, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" },
    });
  } catch {
    return Response.json({ error: "The Python voice API is unavailable." }, { status: 503 });
  }
}
