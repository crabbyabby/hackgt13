from backend.app.adapters.development_agents import development_agents
from backend.app.adapters.memory import InMemoryRepository
from backend.app.adapters.production_agents import production_agents
from backend.app.core.config import settings
from backend.app.services.extraction import ExtractionPipeline
from backend.app.services.publication import PublicationService
from backend.app.services.voice import VoiceSessionService

repository = InMemoryRepository()
agents = production_agents() if settings.extraction_provider == "openai" else development_agents()
extraction_pipeline = ExtractionPipeline(agents=agents, jobs=repository, notes=repository)
publication_service = PublicationService(notes=repository)
voice_session_service = VoiceSessionService()
