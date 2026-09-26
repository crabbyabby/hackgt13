from .extraction import router as extraction_router
from .notes import router as notes_router
from .voice import router as voice_router

__all__ = ["extraction_router", "notes_router", "voice_router"]
