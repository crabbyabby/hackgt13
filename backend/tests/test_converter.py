from PIL import Image

from backend.app.document_processing.pdf_processing import DevelopmentPdfProcessor
from backend.app.document_service import converter


def test_converter_sends_the_original_pdf_instead_of_rebuilt_page_images(tmp_path, monkeypatch):
    source = tmp_path / "original.pdf"
    source.write_bytes(b"%PDF-original-with-text-layer")
    page = tmp_path / "page.png"
    Image.new("RGB", (20, 20), "white").save(page)
    captured = {}

    async def transcribe(**kwargs):
        captured.update(kwargs)
        return await DevelopmentPdfProcessor().process(
            filename=kwargs["filename"], content=kwargs["content"], model=kwargs["model"]
        )

    monkeypatch.setattr(converter.pdf_processing_service, "transcribe", transcribe)

    converter.convert_pages(
        [str(page)],
        provider="development",
        source_path=str(source),
        source_name="lecture-notes.pdf",
    )

    assert captured["filename"] == "lecture-notes.pdf"
    assert captured["content"] == b"%PDF-original-with-text-layer"
