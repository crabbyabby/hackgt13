from backend.app.adapters.development_agents import development_agents
from backend.app.adapters.memory import InMemoryRepository
from backend.app.adapters.production_agents import production_agents
from backend.app.core.config import settings
from backend.app.document_processing.pdf_processing import (
    AiProvider,
    DevelopmentPdfProcessor,
    GeminiPdfProcessor,
    GrokPdfProcessor,
    OpenAIPdfProcessor,
)
from backend.app.services.extraction import ExtractionPipeline
from backend.app.services.pdf_processing import PdfProcessingService
from backend.app.services.publication import PublicationService
from backend.app.services.voice import VoiceSessionService

repository = InMemoryRepository()
agents = production_agents() if settings.extraction_provider == "openai" else development_agents()
extraction_pipeline = ExtractionPipeline(agents=agents, jobs=repository, notes=repository)
pdf_processors = {
    AiProvider.DEVELOPMENT: DevelopmentPdfProcessor(),
}
if settings.openai_api_key:
    pdf_processors[AiProvider.OPENAI] = OpenAIPdfProcessor(
        api_key=settings.openai_api_key, default_model=settings.openai_pdf_model
    )
if settings.gemini_api_key:
    pdf_processors[AiProvider.GOOGLE] = GeminiPdfProcessor(
        api_key=settings.gemini_api_key, default_model=settings.gemini_pdf_model
    )
if settings.xai_api_key:
    pdf_processors[AiProvider.XAI] = GrokPdfProcessor(
        api_key=settings.xai_api_key, default_model=settings.xai_pdf_model
    )
pdf_processing_service = PdfProcessingService(processors=pdf_processors)
publication_service = PublicationService(notes=repository)
voice_session_service = VoiceSessionService()
