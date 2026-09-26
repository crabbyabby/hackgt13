"""Adapter from Mackenzie's page contract to the shared AI transcription service."""

import asyncio
import logging
from io import BytesIO
from time import perf_counter

from PIL import Image

from backend.app.core.container import pdf_processing_service
from backend.app.document_processing.pdf_processing import best_reading

logger = logging.getLogger('eigenscribe.converter')


def _pages_to_pdf(page_images: list[str]) -> bytes:
    pages: list[Image.Image] = []
    try:
        for path in page_images:
            with Image.open(path) as image:
                pages.append(image.convert('RGB'))
        if not pages:
            raise ValueError('No normalized pages were supplied to the converter.')
        output = BytesIO()
        pages[0].save(output, format='PDF', save_all=True, append_images=pages[1:])
        return output.getvalue()
    finally:
        for page in pages:
            page.close()


def convert_pages(
    page_images: list[str],
    *,
    provider: str = 'development',
    model: str = 'development-fixture',
) -> dict:
    """Transcribe normalized pages and adapt them to the persisted review contract."""
    started = perf_counter()
    logger.info(
        'Converter start | pages=%d provider=%s model=%s', len(page_images), provider, model
    )
    pdf_content = _pages_to_pdf(page_images)
    logger.info('Normalized pages assembled | pdf_bytes=%d', len(pdf_content))
    logger.info('Submitting PDF transcription request; waiting for %s/%s…', provider, model)
    transcription = asyncio.run(
        pdf_processing_service.transcribe(
            filename='normalized-notes.pdf',
            content=pdf_content,
            provider=provider,
            model=model,
        )
    )
    region_count = sum(len(page.regions) for page in transcription.pages)
    logger.info(
        'Transcription returned | title=%r pages=%d regions=%d elapsed=%.2fs',
        transcription.documentTitle,
        len(transcription.pages),
        region_count,
        perf_counter() - started,
    )

    blocks = []
    for page in transcription.pages:
        for region in page.regions:
            best = best_reading(region)
            block_type = {
                'heading': 'heading',
                'equation': 'equation',
                'diagram': 'diagram',
                'graph': 'diagram',
            }.get(region.kind, 'paragraph')
            review_reasons = []
            if region.needsReview:
                review_reasons.append('The model marked this region as uncertain.')
            if len(region.interpretations) > 1:
                review_reasons.append(f'{len(region.interpretations)} interpretations were preserved.')
            blocks.append(
                {
                    'id': region.id,
                    'type': block_type,
                    'page': page.pageNumber,
                    'text': region.verbatim if block_type in ('heading', 'paragraph') else '',
                    'latex': (best.latex or region.verbatim) if block_type == 'equation' else '',
                    'description': best.reading if block_type == 'diagram' else '',
                    'spokenText': best.reading,
                    'needsReview': region.needsReview or len(region.interpretations) > 1,
                    'reviewReason': ' '.join(review_reasons),
                    'confidence': region.confidence,
                    'interpretations': [
                        {
                            'reading': candidate.reading,
                            'latex': candidate.latex or '',
                            'confidence': candidate.confidence,
                            'evidence': candidate.evidence,
                        }
                        for candidate in region.interpretations
                    ],
                }
            )
            logger.info(
                'Mapped region | page=%d id=%s type=%s confidence=%.3f review=%s reading=%r',
                page.pageNumber,
                region.id,
                block_type,
                region.confidence,
                region.needsReview or len(region.interpretations) > 1,
                best.reading[:220],
            )

        if not page.regions and page.rawTranscription.strip():
            blocks.append(
                {
                    'id': f'page-{page.pageNumber}-transcription',
                    'type': 'paragraph',
                    'page': page.pageNumber,
                    'text': page.rawTranscription,
                    'latex': '',
                    'description': '',
                    'spokenText': page.rawTranscription,
                    'needsReview': True,
                    'reviewReason': 'No page regions were identified; review the complete page transcription.',
                    'confidence': page.pageConfidence,
                    'interpretations': [],
                }
            )

    if not blocks:
        raise ValueError('The transcription did not contain any reviewable content.')

    logger.info('Converter complete | output_blocks=%d elapsed=%.2fs', len(blocks), perf_counter() - started)

    return {
        'title': transcription.documentTitle or 'Untitled notes',
        'blocks': blocks,
    }
