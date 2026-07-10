@echo off
REM PDFZen One-Click Setup Launcher
REM This batch file launches setup.ps1 with the execution policy bypassed.

echo Launching PDFZen Setup...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if %errorlevel% neq 0 (
    echo.
    echo Setup failed with error code %errorlevel%.
    pause
    exit /b %errorlevel%
)
echo.
echo Setup completed successfully!
pause
