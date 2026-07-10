import io
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import fitz  # PyMuPDF
import pytest
from fastapi.testclient import TestClient

from server import app

@pytest.fixture
def dummy_pdf_bytes():
    """Generate a simple 1-page PDF in memory and return its bytes."""
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 50), "FastAPI Server Test PDF Content")
    pdf_bytes = doc.write()
    doc.close()
    return pdf_bytes

def test_health_route():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "libreoffice" in data

def test_convert_pdf_to_word(dummy_pdf_bytes):
    client = TestClient(app)
    files = {"file": ("test.pdf", dummy_pdf_bytes, "application/pdf")}
    response = client.post("/convert/pdf-to-word", files=files)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    assert 'filename="test.docx"' in response.headers["content-disposition"]
    assert len(response.content) > 0

def test_convert_pdf_to_excel_xlsx(dummy_pdf_bytes):
    client = TestClient(app)
    files = {"file": ("test.pdf", dummy_pdf_bytes, "application/pdf")}
    response = client.post("/convert/pdf-to-excel", files=files, data={"format": "xlsx"})
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert 'filename="test.xlsx"' in response.headers["content-disposition"]
    assert len(response.content) > 0

def test_convert_pdf_to_excel_csv(dummy_pdf_bytes):
    client = TestClient(app)
    files = {"file": ("test.pdf", dummy_pdf_bytes, "application/pdf")}
    response = client.post("/convert/pdf-to-excel", files=files, data={"format": "csv"})
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert 'filename="test.csv"' in response.headers["content-disposition"]
    assert len(response.content) > 0

def test_convert_pdf_to_markdown(dummy_pdf_bytes):
    client = TestClient(app)
    files = {"file": ("test.pdf", dummy_pdf_bytes, "application/pdf")}
    response = client.post("/convert/pdf-to-markdown", files=files)
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/markdown; charset=utf-8"
    assert 'filename="test.md"' in response.headers["content-disposition"]
    assert len(response.content) > 0

def test_convert_pdf_to_jpg(dummy_pdf_bytes):
    client = TestClient(app)
    files = {"file": ("test.pdf", dummy_pdf_bytes, "application/pdf")}
    response = client.post("/convert/pdf-to-jpg", files=files, data={"dpi": "150"})
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert 'filename="test_images.zip"' in response.headers["content-disposition"]
    assert len(response.content) > 0

def test_convert_pdf_to_powerpoint_unavailable(dummy_pdf_bytes):
    client = TestClient(app)
    files = {"file": ("test.pdf", dummy_pdf_bytes, "application/pdf")}
    with patch("server.libreoffice_available", return_value=False):
        response = client.post("/convert/pdf-to-powerpoint", files=files)
        assert response.status_code == 503
        assert "LibreOffice is required" in response.json()["detail"]

def test_convert_pdf_to_powerpoint_success(dummy_pdf_bytes):
    client = TestClient(app)
    files = {"file": ("test.pdf", dummy_pdf_bytes, "application/pdf")}
    
    with tempfile.TemporaryDirectory() as temp_dir:
        dummy_pptx = Path(temp_dir) / "test.pptx"
        dummy_pptx.write_bytes(b"dummy presentation")
        
        mock_convert = AsyncMock(return_value=dummy_pptx)
        
        with patch("server.libreoffice_available", return_value=True), \
             patch("backend.converters.pdf_to_powerpoint", new=mock_convert):
            response = client.post("/convert/pdf-to-powerpoint", files=files)
            assert response.status_code == 200
            assert response.headers["content-type"] == "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            assert 'filename="test.pptx"' in response.headers["content-disposition"]
            assert response.content == b"dummy presentation"

def test_convert_office_to_pdf_success():
    client = TestClient(app)
    # Test Word to PDF
    files = {"file": ("test.docx", b"dummy word content", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
    with tempfile.TemporaryDirectory() as temp_dir:
        dummy_pdf = Path(temp_dir) / "test.pdf"
        dummy_pdf.write_bytes(b"dummy pdf")
        mock_convert = AsyncMock(return_value=dummy_pdf)
        with patch("server.libreoffice_available", return_value=True), \
             patch("backend.converters.office_to_pdf", new=mock_convert):
            response = client.post("/convert/word-to-pdf", files=files)
            assert response.status_code == 200
            assert response.headers["content-type"] == "application/pdf"
            assert 'filename="test.pdf"' in response.headers["content-disposition"]
            assert response.content == b"dummy pdf"

    # Test Excel to PDF
    files = {"file": ("test.xlsx", b"dummy excel content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    with tempfile.TemporaryDirectory() as temp_dir:
        dummy_pdf = Path(temp_dir) / "test.pdf"
        dummy_pdf.write_bytes(b"dummy pdf")
        mock_convert = AsyncMock(return_value=dummy_pdf)
        with patch("server.libreoffice_available", return_value=True), \
             patch("backend.converters.office_to_pdf", new=mock_convert):
            response = client.post("/convert/excel-to-pdf", files=files)
            assert response.status_code == 200
            assert response.headers["content-type"] == "application/pdf"
            assert response.content == b"dummy pdf"

    # Test PowerPoint to PDF
    files = {"file": ("test.pptx", b"dummy pptx content", "application/vnd.openxmlformats-officedocument.presentationml.presentation")}
    with tempfile.TemporaryDirectory() as temp_dir:
        dummy_pdf = Path(temp_dir) / "test.pdf"
        dummy_pdf.write_bytes(b"dummy pdf")
        mock_convert = AsyncMock(return_value=dummy_pdf)
        with patch("server.libreoffice_available", return_value=True), \
             patch("backend.converters.office_to_pdf", new=mock_convert):
            response = client.post("/convert/powerpoint-to-pdf", files=files)
            assert response.status_code == 200
            assert response.headers["content-type"] == "application/pdf"
            assert response.content == b"dummy pdf"


def test_convert_office_to_pdf_unavailable():
    client = TestClient(app)
    files = {"file": ("test.docx", b"dummy word content", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
    with patch("server.libreoffice_available", return_value=False):
        response = client.post("/convert/word-to-pdf", files=files)
        assert response.status_code == 503
        assert "LibreOffice is required" in response.json()["detail"]


def test_empty_file_upload():
    client = TestClient(app)
    files = {"file": ("test.pdf", b"", "application/pdf")}
    response = client.post("/convert/pdf-to-word", files=files)
    assert response.status_code == 400
    assert "empty" in response.json()["detail"]
