import os
import warnings
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf
from PIL import Image, ImageOps

# Handwritten subscripts, superscripts, bars and primes are the first thing lost to low
# resolution, so pages are rendered at a target DPI rather than fitted to a pixel box.
# PDF user space is 72 units per inch, so scale = target DPI / 72.
PDF_POINTS_PER_INCH = 72
TARGET_DPI = int(os.getenv("PAGE_RENDER_DPI", "300"))
MAX_PAGES = int(os.getenv("MAX_PAGES", "25"))
MAX_PIXELS = 40_000_000
# Ceiling on the long edge so a poster-sized page cannot exhaust memory at 300 DPI.
MAX_SIDE = 4200


@dataclass(slots=True)
class PreparedPage:
    number: int
    imagePath: str
    widthPx: int
    heightPx: int
    renderedDpi: int
    # Text drawn by the producing application rather than recognized by a model. When a
    # PDF carries one, it is ground truth: it can be compared against the transcription
    # to catch a model inventing or dropping content on the printed parts of a page.
    embeddedText: str = ""

    @property
    def hasEmbeddedText(self) -> bool:
        return bool(self.embeddedText.strip())


@dataclass(slots=True)
class PreparedDocument:
    pages: list[PreparedPage] = field(default_factory=list)

    @property
    def imagePaths(self) -> list[str]:
        return [page.imagePath for page in self.pages]

    @property
    def embeddedTextByPage(self) -> dict[int, str]:
        return {page.number: page.embeddedText for page in self.pages if page.hasEmbeddedText}


def _scale_for(page: pymupdf.Page, target_dpi: int) -> float:
    """Scale factor for the requested DPI, reduced if it would exceed the size ceilings."""
    scale = target_dpi / PDF_POINTS_PER_INCH
    longest = max(page.rect.width, page.rect.height)
    if longest * scale > MAX_SIDE:
        scale = MAX_SIDE / longest
    if (page.rect.width * scale) * (page.rect.height * scale) > MAX_PIXELS:
        scale = (MAX_PIXELS / (page.rect.width * page.rect.height)) ** 0.5
    return max(scale, 1.0)


def prepare_document(source: Path, kind: str, target_dpi: int = TARGET_DPI) -> PreparedDocument:
    """Render PDF pages or normalize a photo to RGB PNGs, preserving page order."""
    output = source.parent / "pages"
    output.mkdir(exist_ok=True)
    document = PreparedDocument()

    if kind == "pdf":
        with pymupdf.open(source) as pdf:
            if pdf.needs_pass:
                raise ValueError("Password-protected PDFs are not supported.")
            if not 1 <= len(pdf) <= MAX_PAGES:
                raise ValueError(
                    f"PDF contains {len(pdf)} pages; the maximum supported is {MAX_PAGES}."
                )
            for number, page in enumerate(pdf, 1):
                if page.rect.width <= 0 or page.rect.height <= 0:
                    raise ValueError("PDF has an invalid page size.")
                scale = _scale_for(page, target_dpi)
                pixmap = page.get_pixmap(
                    matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csRGB, alpha=False
                )
                path = output / f"{number}.png"
                pixmap.save(path)
                document.pages.append(
                    PreparedPage(
                        number=number,
                        imagePath=str(path.resolve()),
                        widthPx=pixmap.width,
                        heightPx=pixmap.height,
                        renderedDpi=round(scale * PDF_POINTS_PER_INCH),
                        embeddedText=_extract_embedded_text(page),
                    )
                )
        return document

    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(source) as image:
            expected = "PNG" if kind == "png" else "JPEG"
            if image.format != expected or image.width * image.height > MAX_PIXELS:
                raise ValueError("Image format mismatch or too many pixels.")
            image.load()
            # A photographed page carries no DPI we can trust, so it is only bounded, never
            # upscaled: interpolating a blurry photo adds pixels without adding detail.
            normalized = ImageOps.exif_transpose(image).convert("RGB")
            normalized.thumbnail((MAX_SIDE, MAX_SIDE))
            path = output / "1.png"
            normalized.save(path)
            document.pages.append(
                PreparedPage(
                    number=1,
                    imagePath=str(path.resolve()),
                    widthPx=normalized.width,
                    heightPx=normalized.height,
                    renderedDpi=0,
                )
            )
    return document


def _extract_embedded_text(page: pymupdf.Page) -> str:
    """Return the page's own text layer, or empty string for a scan or photograph."""
    try:
        return (page.get_text("text") or "").strip()
    except Exception:  # noqa: BLE001 - a missing or broken text layer is not an error
        return ""


def prepare_pages(source: Path, kind: str) -> list[str]:
    """Backwards-compatible path-only view of `prepare_document`."""
    return prepare_document(source, kind).imagePaths
