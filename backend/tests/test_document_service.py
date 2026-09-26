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
