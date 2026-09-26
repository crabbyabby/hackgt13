const API_BASE_URL = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

export async function GET() {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/voice/agent/session`, {
      cache: "no-store",
    });
    const payload = await response.json() as {
      token?: string;
      url?: string;
      voice?: string;
      expiresAt?: number;
      detail?: string;
    };
    if (!response.ok || !payload.token || !payload.url) {
      return Response.json(
        { error: payload.detail ?? "Grok voice is unavailable." },
        { status: response.status },
      );
    }
    return Response.json({
      token: payload.token,
      url: payload.url,
      voice: payload.voice,
      expiresAt: payload.expiresAt,
    });
  } catch {
    return Response.json({ error: "The Python voice API is unavailable." }, { status: 503 });
  }
}
