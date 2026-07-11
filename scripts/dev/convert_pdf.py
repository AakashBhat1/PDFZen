from pdf2docx import Converter
import sys

pdf_file = 'public/samples/Visit report 030726 Yk-54.pdf'
docx_file = 'public/samples/local_version/py_converted.docx'

try:
    print(f"Starting conversion of {pdf_file} to {docx_file}...")
    cv = Converter(pdf_file)
    cv.convert(docx_file, start=0, end=None)
    cv.close()
    print("Conversion completed successfully!")
except Exception as e:
    print(f"Error occurred: {e}", file=sys.stderr)
    sys.exit(1)
