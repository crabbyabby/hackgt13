"""Adapter from Mackenzie's page contract to the shared AI transcription service."""

import asyncio
from io import BytesIO

from PIL import Image

from backend.app.core.container import pdf_processing_service


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
    pdf_content = _pages_to_pdf(page_images)
    transcription = asyncio.run(
        pdf_processing_service.transcribe(
            filename='normalized-notes.pdf',
            content=pdf_content,
            provider=provider,
            model=model,
        )
    )

    blocks = []
    for page in transcription.pages:
        for region in page.regions:
            best = max(region.interpretations, key=lambda candidate: candidate.confidence)
            block_type = {
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

    return {
        'title': transcription.documentTitle or 'Untitled notes',
        'blocks': blocks,
    }
