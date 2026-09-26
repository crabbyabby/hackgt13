const API_BASE_URL = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

export async function POST(request: Request) {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/voice/narration/script`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
    });
    const payload = await response.json() as { script?: string; detail?: string };
    if (!response.ok) {
      return Response.json(
        { error: payload.detail ?? "Narration script generation failed." },
        { status: response.status },
      );
    }
    return Response.json({ script: payload.script });
  } catch {
    return Response.json({ error: "The Python voice API is unavailable." }, { status: 503 });
  }
}
