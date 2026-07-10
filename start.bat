@echo off
REM PDFZen Startup Script
REM This script runs the frontend and backend servers concurrently in separate windows.

echo ==================================================
echo             Starting PDFZen Services              
echo ==================================================

REM Check if dependencies are installed
if not exist "%~dp0node_modules\" (
    echo [!] Frontend dependencies not found. Please run setup.bat first.
    pause
    exit /b 1
)

if not exist "%~dp0.venv\" (
    echo [!] Backend virtual environment not found. Please run setup.bat first.
    pause
    exit /b 1
)

echo Starting Backend Server (FastAPI on Port 5000)...
start "PDFZen Backend" cmd /k "uv run server.py"

echo Starting Frontend Server (Vite on Port 3000)...
start "PDFZen Frontend" cmd /k "npm run dev"

echo.
echo Both servers are launching!
echo.
echo - Frontend: http://localhost:3000/
echo - Backend: http://localhost:5000/
echo.
echo Press any key to open the frontend in your browser...
pause > nul

start http://localhost:3000/
