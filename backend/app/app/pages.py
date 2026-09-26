from pathlib import Path
import warnings
import pymupdf
from PIL import Image, ImageOps

MAX_PAGES = 3
MAX_PIXELS = 20_000_000
MAX_SIDE = 2000


def prepare_pages(source: Path, kind: str) -> list[str]:
    """Render PDF pages or normalize a photo to RGB PNGs, preserving page order."""
    output = source.parent / 'pages'
    output.mkdir(exist_ok=True)
    if kind == 'pdf':
        with pymupdf.open(source) as pdf:
            if pdf.needs_pass:
                raise ValueError('Password-protected PDFs are not supported.')
            if not 1 <= len(pdf) <= MAX_PAGES:
                raise ValueError(f'Use a PDF with 1–{MAX_PAGES} pages.')
            for number, page in enumerate(pdf, 1):
                if page.rect.width <= 0 or page.rect.height <= 0:
                    raise ValueError('PDF has an invalid page size.')
                scale = min(2, MAX_SIDE / max(page.rect.width, page.rect.height))
                pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csRGB, alpha=False)
                pix.save(output / f'{number}.png')
            count = len(pdf)
    else:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(source) as image:
                expected = 'PNG' if kind == 'png' else 'JPEG'
                if image.format != expected or image.width * image.height > MAX_PIXELS:
                    raise ValueError('Image format mismatch or too many pixels.')
                image.load()
                normalized = ImageOps.exif_transpose(image).convert('RGB')
                normalized.thumbnail((MAX_SIDE, MAX_SIDE))
                normalized.save(output / '1.png')
        count = 1
    return [str((output / f'{n}.png').resolve()) for n in range(1, count + 1)]
