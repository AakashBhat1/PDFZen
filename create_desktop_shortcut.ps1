# PowerShell script to create a Windows Desktop Shortcut for PDFZen

$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "         Creating PDFZen Desktop Shortcut         " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# Define paths
$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
    $scriptDir = Get-Location
}

$targetPath = Join-Path $scriptDir "start.bat"
$iconPath = Join-Path $scriptDir "favicon.ico"
$desktopPath = [System.IO.Path]::Combine([Environment]::GetFolderPath("Desktop"), "PDFZen.lnk")

# Verify source files
if (-not (Test-Path $targetPath)) {
    Write-Error "Error: start.bat not found at $targetPath"
}

if (-not (Test-Path $iconPath)) {
    Write-Warning "Warning: favicon.ico not found at $iconPath. Creating shortcut with default icon."
}

try {
    Write-Host "Creating shortcut at: $desktopPath" -ForegroundColor Gray
    
    $wshShell = New-Object -ComObject WScript.Shell
    $shortcut = $wshShell.CreateShortcut($desktopPath)
    $shortcut.TargetPath = $targetPath
    $shortcut.WorkingDirectory = $scriptDir
    if (Test-Path $iconPath) {
        $shortcut.IconLocation = "$iconPath,0"
    }
    $shortcut.Description = "Launch PDFZen Web and Backend Services"
    $shortcut.Save()
    
    Write-Host "[OK] Desktop shortcut created successfully!" -ForegroundColor Green
    Write-Host "You can now double-click the 'PDFZen' icon on your desktop to run the application." -ForegroundColor Green
} catch {
    Write-Error "Failed to create desktop shortcut: $_"
}
