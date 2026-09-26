"""The only integration point with Person 1. Replace this function when ready."""


def convert_pages(page_images: list[str]) -> dict:
    """Input: absolute PNG paths in page order. Output: title and ordered blocks.

    This MOCK does not inspect the images or call an AI service.
    It returns one clearly labeled paragraph per uploaded page.
    Keep this synchronous interface when connecting the real converter.
    Raise an exception on failure; do not return partial success.
    """
    return {
        'title': 'MOCK — converter not connected',
        'blocks': [
            {
                'id': f'block-{n:03d}',
                'type': 'paragraph',
                'page': n,
                'text': f'Mock content for page {n}. Replace convert_pages with the real converter.',
                'latex': '',
                'description': '',
                'spokenText': f'Mock content for page {n}. The converter is not connected.',
                'needsReview': True,
                'reviewReason': 'Placeholder content; this is not a transcription.'
            }
            for n in range(1, len(page_images) + 1)
        ]
    }
