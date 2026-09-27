const API_BASE_URL = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

export async function POST(request: Request) {
  try {
    console.info("[documents] Uploading source to Python document service…");
    // Forward the multipart stream unchanged. Parsing and rebuilding FormData here
    // buffers the full file in the Worker and can trigger its request-size ceiling.
    const contentType = request.headers.get("content-type");
    if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
      return Response.json({ error: "Upload must use multipart form data." }, { status: 400 });
    }
    const response = await fetch(`${API_BASE_URL}/documents`, {
      method: "POST",
      headers: { "content-type": contentType },
      body: request.body,
    });
    const responseText = await response.text();
    let payload: { id?: string; detail?: string | { message?: string }; error?: string };
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = { detail: responseText || "The upload service returned an unreadable response." };
    }
    console.info(`[documents] Upload response status=${response.status} document=${payload.id ?? "none"}`);
    if (!response.ok) {
      const detail = typeof payload.detail === "string" ? payload.detail : payload.detail?.message;
      return Response.json({ error: detail ?? "The Python document service rejected the upload." }, { status: response.status });
    }
    return Response.json(payload, { status: 202 });
  } catch (error) {
    console.error("[documents] Upload proxy failed", error);
    return Response.json({ error: "The Python API is unavailable. Start it with npm run api." }, { status: 503 });
  }
}
