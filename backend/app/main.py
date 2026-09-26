from backend.app.core.logging import configure_logging

configure_logging()

from backend.app.api.routes import extraction_router, notes_router, pdf_processing_router, voice_router
from backend.app.document_service.main import create_app

# Mackenzie's durable document lifecycle is the canonical application. The
# architecture-first AI/voice routes are mounted alongside it while the frontend
# migrates fully to the persisted document contract.
app = create_app()
app.include_router(extraction_router, prefix="/v1")
app.include_router(pdf_processing_router, prefix="/v1")
app.include_router(notes_router, prefix="/v1")
app.include_router(voice_router, prefix="/v1")
