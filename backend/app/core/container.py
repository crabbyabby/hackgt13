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
from backend.app.services.voice import (
    ElevenLabsVoiceService,
    MathNarrationService,
    VoiceNavigationService,
)

repository = InMemoryRepository()
agents = production_agents() if settings.extraction_provider == "openai" else development_agents()
extraction_pipeline = ExtractionPipeline(agents=agents, jobs=repository, notes=repository)
pdf_processors = {
    AiProvider.DEVELOPMENT: DevelopmentPdfProcessor(),
}
if settings.openai_api_key:
    pdf_processors[AiProvider.OPENAI] = OpenAIPdfProcessor(
        api_key=settings.openai_api_key, default_model=settings.openai_pdf_model, effort=settings.transcription_effort
    )
if settings.gemini_api_key:
    pdf_processors[AiProvider.GOOGLE] = GeminiPdfProcessor(
        api_key=settings.gemini_api_key, default_model=settings.gemini_pdf_model, effort=settings.transcription_effort
    )
if settings.xai_api_key:
    pdf_processors[AiProvider.XAI] = GrokPdfProcessor(
        api_key=settings.xai_api_key, default_model=settings.xai_pdf_model, effort=settings.transcription_effort
    )
pdf_processing_service = PdfProcessingService(processors=pdf_processors)
publication_service = PublicationService(notes=repository)
elevenlabs_voice_service = ElevenLabsVoiceService(
    api_key=settings.elevenlabs_api_key,
    voice_id=settings.elevenlabs_voice_id,
    tts_model=settings.elevenlabs_tts_model,
    stt_model=settings.elevenlabs_stt_model,
)
math_narration_service = MathNarrationService(
    api_key=settings.openai_api_key,
    model=settings.narration_model,
    tts_model=settings.elevenlabs_tts_model,
)
voice_navigation_service = VoiceNavigationService()
