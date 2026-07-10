import os
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import fitz  # PyMuPDF
import pytest

from backend import converters
from backend.libreoffice import LibreOfficeError
from backend.process_executor import CompletedProc

@pytest.fixture
def anyio_backend():
    return "asyncio"

@pytest.fixture
def dummy_pdf_path():
    """Create a temporary PDF file with some text."""
    temp_dir = tempfile.mkdtemp(prefix="pdfzen_test_")
    pdf_path = Path(temp_dir) / "test_doc.pdf"
    
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 50), "Line 1 Column 1    Line 1 Column 2")
    page.insert_text((50, 100), "Line 2 Column 1    Line 2 Column 2")
    doc.save(str(pdf_path))
    doc.close()
    
    yield pdf_path
    
    # Cleanup
    if pdf_path.is_file():
        pdf_path.unlink()
    try:
        os.rmdir(temp_dir)
    except OSError:
        pass

@pytest.mark.anyio
async def test_pdf_to_word(dummy_pdf_path):
    out_dir = dummy_pdf_path.parent
    result_path = await converters.pdf_to_word(dummy_pdf_path, out_dir)
    assert result_path.is_file()
    assert result_path.suffix == ".docx"
    assert result_path.stat().st_size > 0
    result_path.unlink()

@pytest.mark.anyio
async def test_pdf_to_excel_xlsx(dummy_pdf_path):
    out_dir = dummy_pdf_path.parent
    result_path = await converters.pdf_to_excel(dummy_pdf_path, out_dir, fmt="xlsx")
    assert result_path.is_file()
    assert result_path.suffix == ".xlsx"
    assert result_path.stat().st_size > 0
    result_path.unlink()

@pytest.mark.anyio
async def test_pdf_to_excel_csv(dummy_pdf_path):
    out_dir = dummy_pdf_path.parent
    result_path = await converters.pdf_to_excel(dummy_pdf_path, out_dir, fmt="csv")
    assert result_path.is_file()
    assert result_path.suffix == ".csv"
    assert result_path.stat().st_size > 0
    result_path.unlink()

@pytest.mark.anyio
async def test_pdf_to_markdown(dummy_pdf_path):
    out_dir = dummy_pdf_path.parent
    result_path = await converters.pdf_to_markdown(dummy_pdf_path, out_dir)
    assert result_path.is_file()
    assert result_path.suffix == ".md"
    content = result_path.read_text(encoding="utf-8")
    assert "Line 1" in content or "Line 2" in content
    result_path.unlink()

@pytest.mark.anyio
async def test_pdf_to_jpg(dummy_pdf_path):
    out_dir = dummy_pdf_path.parent
    result_path = await converters.pdf_to_jpg(dummy_pdf_path, out_dir, dpi=100)
    assert result_path.is_file()
    assert result_path.suffix == ".zip"
    
    # Verify ZIP structure
    with zipfile.ZipFile(result_path, "r") as archive:
        namelist = archive.namelist()
        assert len(namelist) == 1
        assert namelist[0].endswith(".jpg")
        
    result_path.unlink()

@pytest.mark.anyio
async def test_pdf_to_powerpoint_mocked(dummy_pdf_path):
    out_dir = dummy_pdf_path.parent
    
    # We create a dummy file to represent soffice executable so validate_command passes
    dummy_soffice = out_dir / "soffice.exe"
    dummy_soffice.write_bytes(b"")
    
    expected_pptx = out_dir / f"{dummy_pdf_path.stem}.pptx"
    
    async def mock_run(cmd, tool, timeout_s=None):
        # Touch expected output file to simulate successful conversion
        expected_pptx.write_bytes(b"dummy pptx presentation")
        return CompletedProc(returncode=0, stdout=b"", stderr=b"")
        
    with patch("backend.libreoffice.get_soffice_path", return_value=str(dummy_soffice)), \
         patch("backend.process_executor.run", new=AsyncMock(side_effect=mock_run)):
         
        result_path = await converters.pdf_to_powerpoint(dummy_pdf_path, out_dir)
        assert result_path == expected_pptx
        assert result_path.is_file()
        assert result_path.read_text() == "dummy pptx presentation"
        result_path.unlink()
        
    dummy_soffice.unlink()

@pytest.mark.anyio
async def test_pdf_to_powerpoint_missing_soffice(dummy_pdf_path):
    out_dir = dummy_pdf_path.parent
    with patch("backend.libreoffice.get_soffice_path", return_value=None):
        with pytest.raises(LibreOfficeError) as exc_info:
            await converters.pdf_to_powerpoint(dummy_pdf_path, out_dir)
        assert "soffice) was not found" in str(exc_info.value)


@pytest.mark.anyio
async def test_office_to_pdf_mocked(tmp_path):
    # Create dummy input document
    input_doc = tmp_path / "test.docx"
    input_doc.write_bytes(b"dummy docx")
    
    # We create a dummy file to represent soffice executable so validate_command passes
    dummy_soffice = tmp_path / "soffice.exe"
    dummy_soffice.write_bytes(b"")
    
    expected_pdf = tmp_path / "test.pdf"
    
    async def mock_run(cmd, tool, timeout_s=None):
        # Touch expected output file to simulate successful conversion
        expected_pdf.write_bytes(b"dummy pdf output")
        return CompletedProc(returncode=0, stdout=b"", stderr=b"")
        
    with patch("backend.libreoffice.get_soffice_path", return_value=str(dummy_soffice)), \
         patch("backend.process_executor.run", new=AsyncMock(side_effect=mock_run)):
         
        result_path = await converters.office_to_pdf(input_doc, tmp_path)
        assert result_path == expected_pdf
        assert result_path.is_file()
        assert result_path.read_text() == "dummy pdf output"
        result_path.unlink()
        
    dummy_soffice.unlink()


@pytest.mark.anyio
async def test_office_to_pdf_missing_soffice(tmp_path):
    input_doc = tmp_path / "test.docx"
    input_doc.write_bytes(b"dummy docx")
    with patch("backend.libreoffice.get_soffice_path", return_value=None):
        with pytest.raises(LibreOfficeError) as exc_info:
            await converters.office_to_pdf(input_doc, tmp_path)
        assert "soffice) was not found" in str(exc_info.value)
