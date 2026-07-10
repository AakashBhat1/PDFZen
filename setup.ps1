# PDFZen Setup Script for Windows (PowerShell)
# This script automates Node.js and Astral uv installation, and sets up dependencies.

$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "         PDFZen Setup & Dependency Installer      " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# Helper to check if a command exists in current PATH
function Test-CommandExists($Name) {
    return ($null -ne (Get-Command $Name -ErrorAction SilentlyContinue))
}

# Helper to add a directory to current session's PATH
function Add-ToPath($PathDir) {
    if (Test-Path $PathDir) {
        if (-not ($env:Path -split ";" -contains $PathDir)) {
            $env:Path = "$PathDir;$env:Path"
            Write-Host "Added to PATH for this session: $PathDir" -ForegroundColor Gray
        }
    }
}

$hasWinget = Test-CommandExists "winget"

# --------------------------------------------------
# 1. Install Node.js if missing
# --------------------------------------------------
if (Test-CommandExists "node") {
    $nodeVer = (node -v).Trim()
    Write-Host "[OK] Node.js is already installed (Version: $nodeVer)" -ForegroundColor Green
} else {
    Write-Host "[!] Node.js is missing. Installing Node.js..." -ForegroundColor Yellow
    if ($hasWinget) {
        Write-Host "Installing Node.js via winget..." -ForegroundColor Cyan
        winget install OpenJS.NodeJS --source winget --accept-package-agreements --accept-source-agreements --silent
    } else {
        Write-Host "winget not found. Downloading Node.js MSI installer..." -ForegroundColor Cyan
        $msiPath = "$env:TEMP\node-install.msi"
        # Download Node.js LTS (v20)
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi" -OutFile $msiPath
        Write-Host "Running Node.js silent installer (requires UAC approval if prompted)..." -ForegroundColor Cyan
        Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait
    }
    
    # Try to add Node.js installation path to session path
    Add-ToPath "C:\Program Files\nodejs"
    Add-ToPath "$env:APPDATA\npm"
    
    if (Test-CommandExists "node") {
        $nodeVer = (node -v).Trim()
        Write-Host "[OK] Node.js successfully installed (Version: $nodeVer)" -ForegroundColor Green
    } else {
        Write-Warning "Node.js was installed, but 'node' command is still not found in current PATH. You might need to restart your terminal."
    }
}

# --------------------------------------------------
# 2. Install Astral uv if missing
# --------------------------------------------------
if (Test-CommandExists "uv") {
    $uvVer = (uv --version).Trim()
    Write-Host "[OK] Astral uv is already installed ($uvVer)" -ForegroundColor Green
} else {
    Write-Host "[!] Astral uv is missing. Installing uv..." -ForegroundColor Yellow
    if ($hasWinget) {
        Write-Host "Installing uv via winget..." -ForegroundColor Cyan
        winget install Astral.uv --source winget --accept-package-agreements --accept-source-agreements --silent
    } else {
        Write-Host "Installing uv via official installer script..." -ForegroundColor Cyan
        powershell -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
    }

    # Add uv bin folder to current session's PATH
    Add-ToPath "$env:USERPROFILE\.local\bin"
    Add-ToPath "$env:APPDATA\astral-uv\bin"

    if (Test-CommandExists "uv") {
        $uvVer = (uv --version).Trim()
        Write-Host "[OK] Astral uv successfully installed ($uvVer)" -ForegroundColor Green
    } else {
        Write-Warning "uv was installed, but 'uv' command is still not found in current PATH. You might need to restart your terminal."
    }
}

# --------------------------------------------------
# 3. Setup Frontend Dependencies (npm install)
# --------------------------------------------------
Write-Host "`n--------------------------------------------------" -ForegroundColor Cyan
Write-Host "Setting up Frontend Dependencies..." -ForegroundColor Cyan
Write-Host "--------------------------------------------------" -ForegroundColor Cyan
if (Test-CommandExists "npm") {
    Write-Host "Running npm install..." -ForegroundColor Cyan
    npm install
    Write-Host "[OK] Frontend dependencies installed successfully." -ForegroundColor Green
} else {
    Write-Warning "npm command not found. Please verify Node.js installation."
}

# --------------------------------------------------
# 4. Setup Backend Virtual Environment & Packages (uv sync)
# --------------------------------------------------
Write-Host "`n--------------------------------------------------" -ForegroundColor Cyan
Write-Host "Setting up Backend Environment..." -ForegroundColor Cyan
Write-Host "--------------------------------------------------" -ForegroundColor Cyan
if (Test-CommandExists "uv") {
    Write-Host "Running uv sync (this will also download Python 3.13 if needed)..." -ForegroundColor Cyan
    uv sync
    Write-Host "[OK] Backend virtual environment and dependencies synchronized successfully." -ForegroundColor Green
} else {
    Write-Warning "uv command not found. Please verify Astral uv installation."
}

# --------------------------------------------------
# 5. Check and optionally install LibreOffice (for PowerPoint conversions)
# --------------------------------------------------
Write-Host "`n--------------------------------------------------" -ForegroundColor Cyan
Write-Host "Checking for LibreOffice..." -ForegroundColor Cyan
Write-Host "--------------------------------------------------" -ForegroundColor Cyan

$sofficeInstalled = $false
$sofficePath = $null
if ($env:SOFFICE_PATH -and (Test-Path $env:SOFFICE_PATH)) {
    $sofficeInstalled = $true
    $sofficePath = $env:SOFFICE_PATH
} elseif (Test-CommandExists "soffice") {
    $sofficeInstalled = $true
} else {
    $commonPaths = @(
        "C:\Program Files\LibreOffice\program\soffice.exe",
        "C:\Program Files (x86)\LibreOffice\program\soffice.exe"
    )
    foreach ($p in $commonPaths) {
        if (Test-Path $p) {
            $sofficeInstalled = $true
            $sofficePath = $p
            break
        }
    }
}

if ($sofficeInstalled) {
    Write-Host "[OK] LibreOffice is already installed." -ForegroundColor Green
} else {
    Write-Host "[!] LibreOffice is missing. It is required for high-fidelity PowerPoint conversion." -ForegroundColor Yellow
    if ($hasWinget) {
        Write-Host "Installing LibreOffice via winget (this might take a few minutes, UAC elevation may be requested)..." -ForegroundColor Cyan
        winget install TheDocumentFoundation.LibreOffice --source winget --accept-package-agreements --accept-source-agreements --silent
        Add-ToPath "C:\Program Files\LibreOffice\program"
        if (Test-Path "C:\Program Files\LibreOffice\program\soffice.exe") {
            Write-Host "[OK] LibreOffice successfully installed." -ForegroundColor Green
        } else {
            Write-Warning "LibreOffice installer finished, but soffice.exe was not found at standard path."
        }
    } else {
        Write-Warning "winget not found. Please install LibreOffice manually from https://www.libreoffice.org/ to enable PowerPoint conversions."
    }
}

Write-Host "`n==================================================" -ForegroundColor Green
Write-Host "Setup completed! You are ready to start PDFZen." -ForegroundColor Green
Write-Host "Use 'start.bat' to launch the frontend & backend." -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
