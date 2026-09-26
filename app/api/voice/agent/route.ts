const API_BASE_URL = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

export async function GET() {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/voice/agent/signed-url`, {
      cache: "no-store",
    });
    const payload = await response.json() as { signedUrl?: string; detail?: string };
    if (!response.ok) {
      return Response.json(
        { error: payload.detail ?? "ElevenLabs voice agent is unavailable." },
        { status: response.status },
      );
    }
    return Response.json({ signedUrl: payload.signedUrl });
  } catch {
    return Response.json({ error: "The Python voice API is unavailable." }, { status: 503 });
  }
}
