@echo off
REM PDFZen entrypoint — single launcher that owns Ollama + servers and cleans up on close.
cd /d "%~dp0"
title PDFZen Launcher
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-pdfzen.ps1"
if errorlevel 1 pause
