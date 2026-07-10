import os
import tempfile
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pdf2docx import Converter
import pdfplumber
import pandas as pd

app = FastAPI(title="PDFZen Local Conversion Backend")

# Allow CORS so that the Vite dev server (usually localhost:3000) can access the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/convert/pdf-to-word")
async def convert_pdf_to_word(file: UploadFile = File(...)):
    # Create temporary input and output paths
    temp_dir = tempfile.mkdtemp()
    input_path = os.path.join(temp_dir, file.filename)
    output_filename = os.path.splitext(file.filename)[0] + ".docx"
    output_path = os.path.join(temp_dir, output_filename)
    
    try:
        # Save uploaded file
        with open(input_path, "wb") as f:
            f.write(await file.read())
            
        # Run conversion
        cv = Converter(input_path)
        cv.convert(output_path, start=0, end=None)
        cv.close()
        
        if not os.path.exists(output_path):
            raise HTTPException(status_code=500, detail="Conversion failed to create output file.")
            
        return FileResponse(
            output_path, 
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename=output_filename
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

@app.post("/convert/pdf-to-excel")
async def convert_pdf_to_excel(file: UploadFile = File(...), format: str = Form("xlsx")):
    temp_dir = tempfile.mkdtemp()
    input_path = os.path.join(temp_dir, file.filename)
    
    ext = ".xlsx" if format == "xlsx" else ".csv"
    output_filename = os.path.splitext(file.filename)[0] + ext
    output_path = os.path.join(temp_dir, output_filename)
    
    try:
        with open(input_path, "wb") as f:
            f.write(await file.read())
            
        # Extract tables using pdfplumber
        all_tables = []
        with pdfplumber.open(input_path) as pdf:
            for page_idx, page in enumerate(pdf.pages):
                tables = page.extract_tables()
                for table_idx, table in enumerate(tables):
                    if table:
                        df = pd.DataFrame(table)
                        # sheet name limit is 31 chars
                        name = f"P{page_idx+1}_T{table_idx+1}"
                        all_tables.append((name, df))
                        
        # Fallback if no tables detected: extract text line-by-line
        if not all_tables:
            fallback_rows = []
            with pdfplumber.open(input_path) as pdf:
                for page in pdf.pages:
                    text = page.extract_text()
                    if text:
                        for line in text.split("\n"):
                            fallback_rows.append(line.split())
            if fallback_rows:
                df = pd.DataFrame(fallback_rows)
                all_tables.append(("Extracted Text", df))
                
        if not all_tables:
            raise HTTPException(status_code=400, detail="No text or tables could be extracted from this PDF.")
            
        # Write to spreadsheet
        if format == "xlsx":
            with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
                for sheet_name, df in all_tables:
                    df.to_excel(writer, sheet_name=sheet_name[:31], index=False, header=False)
        else:
            df_all = pd.concat([df for _, df in all_tables], ignore_index=True)
            df_all.to_csv(output_path, index=False, header=False)
            
        return FileResponse(
            output_path,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if format == "xlsx" else "text/csv",
            filename=output_filename
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=5000, reload=True)
