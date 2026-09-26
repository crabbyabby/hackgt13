from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from backend.app.document_service.main import create_app


def _png_bytes() -> bytes:
    output = BytesIO()
    Image.new("RGB", (64, 64), "white").save(output, format="PNG")
    return output.getvalue()


def test_document_workflow_uses_persistence_and_shared_converter(tmp_path):
    with TestClient(create_app(data_dir=tmp_path)) as client:
        upload = client.post(
            "/documents",
            files={"file": ("notes.png", _png_bytes(), "image/png")},
            data={"provider": "development", "model": "development-fixture"},
        )

        assert upload.status_code == 202
        document_id = upload.json()["id"]
        document = client.get(f"/documents/{document_id}").json()
        assert document["status"] == "needs_review"
        assert document["aiProvider"] == "development"
        assert document["aiModel"] == "development-fixture"
        assert document["pages"][0]["imageUrl"].endswith("/pages/1")

        note_response = client.get(f"/documents/{document_id}/semantic-note")
        assert note_response.status_code == 200
        note = note_response.json()
        assert note["source"]["documentId"] == document_id
        assert note["source"]["aiModel"] == "development-fixture"
        assert len(note["blocks"][0]["interpretations"]) == 2

        slug_response = client.get(f"/notes/{note['slug']}")
        assert slug_response.status_code == 200
        assert slug_response.json()["id"] == document_id


def test_published_equations_carry_mathml_and_a_navigable_tree(tmp_path):
    """The development fixture emits a valid equation, so the note must carry MathML."""
    with TestClient(create_app(data_dir=tmp_path)) as client:
        upload = client.post(
            "/documents",
            files={"file": ("notes.png", _png_bytes(), "image/png")},
            data={"provider": "development", "model": "development-fixture"},
        )
        document_id = upload.json()["id"]
        note = client.get(f"/documents/{document_id}/semantic-note").json()

    equations = [block for block in note["blocks"] if block["kind"] == "equation"]
    assert equations, "the development fixture should produce an equation block"
    math = equations[0]["math"]
    assert math["mathml"].startswith("<math")
    assert math["mathmlError"] is None
    # Rendered notation is not enough on its own; the reader needs navigable parts.
    assert math["tree"]["latex"]


def test_uncompilable_notation_is_forced_back_to_review(tmp_path):
    """A model can emit LaTeX that will not parse; that must never publish silently."""
    def broken_converter(page_images, **_kwargs):
        return {
            "title": "Broken notation",
            "blocks": [{
                "id": "block-001", "type": "equation", "page": 1,
                "text": "", "latex": r"\frac{a}{", "description": "",
                "spokenText": "a over something", "needsReview": False, "reviewReason": "",
            }],
        }

    with TestClient(create_app(data_dir=tmp_path, converter=broken_converter)) as client:
        upload = client.post(
            "/documents", files={"file": ("notes.png", _png_bytes(), "image/png")}
        )
        document_id = upload.json()["id"]
        note = client.get(f"/documents/{document_id}/semantic-note").json()

    block = note["blocks"][0]
    assert block["math"]["mathml"] is None
    assert "did not compile" in block["math"]["mathmlError"]
    # The converter said this block was fine. The deterministic gate overrides it.
    assert block["needsReview"] is True


def test_flattened_matrix_notation_is_sent_back_to_review(tmp_path):
    """Compiling is necessary but not sufficient: wrong structure must not publish."""
    def flattening_converter(page_images, **_kwargs):
        return {
            "title": "Flattened notation",
            "blocks": [{
                "id": "block-001", "type": "equation", "page": 1,
                "text": "", "latex": "[3; -2; -1; 0]", "description": "",
                "spokenText": "three, minus two, minus one, zero",
                "needsReview": False, "reviewReason": "",
            }],
        }

    with TestClient(create_app(data_dir=tmp_path, converter=flattening_converter)) as client:
        upload = client.post("/documents", files={"file": ("notes.png", _png_bytes(), "image/png")})
        note = client.get(f"/documents/{upload.json()['id']}/semantic-note").json()

    block = note["blocks"][0]
    # It compiled, so mathml exists and mathmlError is clear...
    assert block["math"]["mathml"] is not None
    assert block["math"]["mathmlError"] is None
    # ...but the structure is wrong, so it still must not pass as reviewed.
    assert block["math"]["structureWarning"] is not None
    assert block["needsReview"] is True
