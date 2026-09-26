from backend.app.document_processing.pdf_processing import (
    AiProvider,
    PdfModelOption,
    PdfProcessor,
    PdfTranscription,
    provider_for_model,
    supported_pdf_models,
)


class PdfProcessingService:
    def __init__(self, processors: dict[AiProvider, PdfProcessor]) -> None:
        self.processors = processors

    def models(self) -> list[PdfModelOption]:
        return [
            option.model_copy(update={"available": option.provider in self.processors})
            for option in supported_pdf_models()
        ]

    async def transcribe(
        self,
        *,
        filename: str,
        content: bytes,
        provider: str | AiProvider | None,
        model: str,
    ) -> PdfTranscription:
        selected_provider = AiProvider(provider) if provider else provider_for_model(model)
        processor = self.processors.get(selected_provider)
        if processor is None:
            key_names = {
                AiProvider.OPENAI: "OPENAI_API_KEY",
                AiProvider.GOOGLE: "GEMINI_API_KEY",
                AiProvider.XAI: "XAI_API_KEY",
            }
            key_name = key_names.get(selected_provider, "the provider API key")
            raise ValueError(f"{selected_provider.value} is unavailable. Configure {key_name} in .env.local.")
        return await processor.process(filename=filename, content=content, model=model)
