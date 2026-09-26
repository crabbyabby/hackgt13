from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.routes import extraction_router, notes_router, voice_router

app = FastAPI(
    title="EigenScribe API",
    version="0.1.0",
    description="Semantic math-note extraction, review, publication, and voice navigation API.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(extraction_router, prefix="/v1")
app.include_router(notes_router, prefix="/v1")
app.include_router(voice_router, prefix="/v1")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "eigenscribe-api"}
