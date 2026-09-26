import asyncio
import logging
import os
from time import perf_counter

from backend.app.document_processing.pdf_processing import (
    AiProvider,
    PdfModelOption,
    PdfProcessor,
    PdfTranscription,
    provider_for_model,
    supported_pdf_models,
)

logger = logging.getLogger("eigenscribe.pdf")
PROGRESS_INTERVAL_SECONDS = float(os.getenv("MODEL_PROGRESS_INTERVAL_SECONDS", "10"))


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
        started = perf_counter()
        logger.info(
            "PDF dispatch | filename=%r bytes=%d provider=%s model=%s",
            filename,
            len(content),
            selected_provider.value,
            model,
        )
        processor = self.processors.get(selected_provider)
        if processor is None:
            key_names = {
                AiProvider.OPENAI: "OPENAI_API_KEY",
                AiProvider.GOOGLE: "GEMINI_API_KEY",
                AiProvider.XAI: "XAI_API_KEY",
            }
            key_name = key_names.get(selected_provider, "the provider API key")
            raise ValueError(f"{selected_provider.value} is unavailable. Configure {key_name} in .env.local.")
        logger.info("PDF processor selected; waiting for provider response…")
        task = asyncio.create_task(
            processor.process(filename=filename, content=content, model=model)
        )
        try:
            while not task.done():
                done, _ = await asyncio.wait({task}, timeout=PROGRESS_INTERVAL_SECONDS)
                if task not in done:
                    logger.info(
                        "PDF model still processing | provider=%s model=%s elapsed=%.1fs",
                        selected_provider.value,
                        model,
                        perf_counter() - started,
                    )
            result = await task
        finally:
            if not task.done():
                task.cancel()
        logger.info(
            "PDF dispatch complete | provider=%s model=%s pages=%d elapsed=%.2fs",
            selected_provider.value,
            model,
            result.pageCount,
            perf_counter() - started,
        )
        return result
