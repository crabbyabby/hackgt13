const API_BASE_URL = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

export async function POST(request: Request) {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/voice/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
    });
    if (!response.ok) {
      const payload = await response.json();
      return Response.json({ error: payload.detail ?? "ElevenLabs speech generation failed." }, { status: response.status });
    }
    return new Response(response.body, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "The Python voice API is unavailable." }, { status: 503 });
  }
}
