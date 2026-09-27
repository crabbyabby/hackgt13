from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from backend.app.document_service.pages import TARGET_DPI, prepare_document, prepare_pages


def _write_pdf(directory: Path, pages: list[str]) -> Path:
    document = pymupdf.open()
    for text in pages:
        document.new_page().insert_text((72, 100), text, fontsize=14)
    path = directory / "original.pdf"
    document.save(path)
    document.close()
    return path


def test_pdf_pages_render_at_the_target_dpi(tmp_path):
    source = _write_pdf(tmp_path, ["Ax = lambda x"])

    prepared = prepare_document(source, "pdf")

    assert len(prepared.pages) == 1
    page = prepared.pages[0]
    # Handwritten sub- and superscripts are the first detail lost to low resolution, so
    # the render must actually reach the requested density rather than a pixel-box fit.
    assert page.renderedDpi == TARGET_DPI
    assert page.widthPx > 2000
    assert Path(page.imagePath).exists()


def test_embedded_text_layer_is_captured_as_ground_truth(tmp_path):
    source = _write_pdf(tmp_path, ["Eigenvalue equation", "Second page"])

    prepared = prepare_document(source, "pdf")

    assert len(prepared.pages) == 2
    assert prepared.pages[0].hasEmbeddedText is True
    assert "Eigenvalue" in prepared.pages[0].embeddedText
    assert sorted(prepared.embeddedTextByPage) == [1, 2]


def test_scanned_pages_report_no_embedded_text(tmp_path):
    document = pymupdf.open()
    document.new_page()  # A page with no text operators stands in for a scan.
    source = tmp_path / "original.pdf"
    document.save(source)
    document.close()

    prepared = prepare_document(source, "pdf")

    assert prepared.pages[0].hasEmbeddedText is False
    assert prepared.embeddedTextByPage == {}


def test_photographs_are_normalized_but_never_upscaled(tmp_path):
    source = tmp_path / "original.png"
    Image.new("RGB", (800, 600), "white").save(source)

    prepared = prepare_document(source, "png")

    assert len(prepared.pages) == 1
    page = prepared.pages[0]
    assert (page.widthPx, page.heightPx) == (800, 600)
    # A photograph carries no trustworthy DPI, so none is claimed.
    assert page.renderedDpi == 0
    assert page.hasEmbeddedText is False


def test_password_protected_pdfs_are_rejected(tmp_path):
    document = pymupdf.open()
    document.new_page()
    source = tmp_path / "original.pdf"
    document.save(source, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="user")
    document.close()

    with pytest.raises(ValueError, match="Password-protected"):
        prepare_document(source, "pdf")


def test_pdf_page_limit_error_reports_actual_page_count(tmp_path):
    source = _write_pdf(tmp_path, [f"Page {number}" for number in range(11)])

    with pytest.raises(ValueError, match=r"PDF contains 11 pages; the maximum supported is 10"):
        prepare_document(source, "pdf")


def test_legacy_prepare_pages_still_returns_paths(tmp_path):
    source = _write_pdf(tmp_path, ["one", "two"])

    paths = prepare_pages(source, "pdf")

    assert len(paths) == 2
    assert all(Path(path).exists() for path in paths)
