const API_BASE_URL = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

export async function POST(request: Request) {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/voice/transcriptions`, {
      method: "POST",
      body: await request.formData(),
    });
    const payload = await response.json();
    if (!response.ok) return Response.json({ error: payload.detail ?? "Voice transcription failed." }, { status: response.status });
    return Response.json(payload);
  } catch {
    return Response.json({ error: "The Python voice API is unavailable." }, { status: 503 });
  }
}
