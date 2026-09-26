const API_BASE_URL = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

export async function GET() {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/pdf-processing/models`, { cache: "no-store" });
    const payload = await response.json();
    return Response.json(payload, { status: response.status });
  } catch {
    return Response.json({ error: "The Python API is unavailable. Start it with npm run api." }, { status: 503 });
  }
}
