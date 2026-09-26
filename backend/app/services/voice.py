from backend.app.domain.models import SemanticNote


class VoiceSessionService:
    async def create(self, _note: SemanticNote) -> dict:
        # TODO(realtime): Request an ephemeral browser credential from the voice provider.
        # TODO(tools): Register semantic navigation commands and keep cursor state server-owned.
        # TODO(accessibility): Return captions and preserve a text/keyboard fallback.
        raise NotImplementedError("Realtime voice sessions are not implemented")
