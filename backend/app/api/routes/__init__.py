from .extraction import router as extraction_router
from .notes import router as notes_router
from .pdf_processing import router as pdf_processing_router
from .voice import router as voice_router

__all__ = ["extraction_router", "notes_router", "pdf_processing_router", "voice_router"]
