# PDFZen launcher — starts Ollama (Vulkan/iGPU) + backend + frontend in one session.
# Closing this window (or Ctrl+C) stops the app processes and Ollama if we started it.
# Process stdout/stderr is written under logs\ for Settings → Service logs.

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$LogDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-LauncherLog {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path (Join-Path $LogDir "launcher.log") -Value $line -ErrorAction SilentlyContinue
    Write-Host $Message
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "           PDFZen Launcher                        " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-LauncherLog "Launcher start. Logs folder: $LogDir"

if (-not (Test-Path (Join-Path $Root "node_modules"))) {
    Write-Host "[!] Frontend dependencies missing. Run setup.bat first." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
if (-not (Test-Path (Join-Path $Root ".venv"))) {
    Write-Host "[!] Backend venv missing. Run setup.bat first." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# ---------- env for Ollama ----------
$env:OLLAMA_VULKAN = "1"
$env:OLLAMA_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,*"
$env:OLLAMA_FLASH_ATTENTION = "1"
# Modest default context — single-page analyzer does not need huge windows.
if (-not $env:OLLAMA_CONTEXT_LENGTH) {
    $env:OLLAMA_CONTEXT_LENGTH = "4096"
}
if (-not $env:GGML_VK_VISIBLE_DEVICES) {
    $env:GGML_VK_VISIBLE_DEVICES = "0"
}

$script:StartedOllama = $false
$script:BackendProc = $null
$script:FrontendProc = $null
$script:OllamaProc = $null
$script:CleaningUp = $false

function Test-OllamaApi {
    try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2
        return $true
    }
    catch {
        return $false
    }
}

function Stop-ProcessTree {
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return }
    try {
        & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
    }
    catch { }
    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
    catch { }
}

function Invoke-Cleanup {
    if ($script:CleaningUp) { return }
    $script:CleaningUp = $true
    Write-Host ""
    Write-Host "Shutting down PDFZen services..." -ForegroundColor Yellow
    Write-LauncherLog "Cleanup started"

    if ($null -ne $script:FrontendProc) {
        if (-not $script:FrontendProc.HasExited) {
            Write-Host "  Stopping frontend (pid $($script:FrontendProc.Id))..." -ForegroundColor Gray
            Stop-ProcessTree -ProcessId $script:FrontendProc.Id
        }
    }
    if ($null -ne $script:BackendProc) {
        if (-not $script:BackendProc.HasExited) {
            Write-Host "  Stopping backend (pid $($script:BackendProc.Id))..." -ForegroundColor Gray
            Stop-ProcessTree -ProcessId $script:BackendProc.Id
        }
    }

    if ($script:StartedOllama) {
        Write-Host "  Stopping Ollama (started by this launcher)..." -ForegroundColor Gray
        if ($null -ne $script:OllamaProc) {
            if (-not $script:OllamaProc.HasExited) {
                Stop-ProcessTree -ProcessId $script:OllamaProc.Id
            }
        }
        Get-Process -Name "ollama", "Ollama" -ErrorAction SilentlyContinue | ForEach-Object {
            Stop-ProcessTree -ProcessId $_.Id
        }
    }

    Write-Host "[OK] Cleanup complete." -ForegroundColor Green
    Write-LauncherLog "Cleanup complete"
}

function Start-OllamaVulkan {
    Write-Host "[1/3] Ollama + Vulkan (iGPU)..." -ForegroundColor Cyan
    Write-Host "      NPU is not used by Ollama; Vulkan iGPU is the accel path." -ForegroundColor DarkYellow
    Write-LauncherLog "Starting Ollama (Vulkan)"

    $ollamaExe = $null
    $cmd = Get-Command ollama -ErrorAction SilentlyContinue
    if ($null -ne $cmd) {
        $ollamaExe = $cmd.Source
    }
    elseif (Test-Path "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe") {
        $ollamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    }

    if ($null -eq $ollamaExe) {
        Write-Host "[!] Ollama not installed — AI Page Analyzer will not work until you install it." -ForegroundColor Yellow
        Write-LauncherLog "Ollama not installed"
        return
    }

    if (Test-OllamaApi) {
        Write-Host "      API already up — restarting so Vulkan flags apply..." -ForegroundColor Gray
        Write-LauncherLog "Restarting existing Ollama"
        Get-Process -Name "ollama", "Ollama" -ErrorAction SilentlyContinue | ForEach-Object {
            Stop-ProcessTree -ProcessId $_.Id
        }
        Start-Sleep -Seconds 2
    }

    $ollamaLog = Join-Path $LogDir "ollama.log"
    $ollamaErr = Join-Path $LogDir "ollama.err.log"
    # Truncate previous session logs for readability
    "" | Set-Content -Path $ollamaLog -Encoding utf8
    "" | Set-Content -Path $ollamaErr -Encoding utf8

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ollamaExe
    $psi.Arguments = "serve"
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WorkingDirectory = $Root
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.EnvironmentVariables["OLLAMA_VULKAN"] = "1"
    $psi.EnvironmentVariables["OLLAMA_ORIGINS"] = $env:OLLAMA_ORIGINS
    $psi.EnvironmentVariables["OLLAMA_FLASH_ATTENTION"] = "1"
    $psi.EnvironmentVariables["OLLAMA_CONTEXT_LENGTH"] = $env:OLLAMA_CONTEXT_LENGTH
    $psi.EnvironmentVariables["GGML_VK_VISIBLE_DEVICES"] = $env:GGML_VK_VISIBLE_DEVICES

    $script:OllamaProc = [System.Diagnostics.Process]::Start($psi)
    $script:StartedOllama = $true

    # Async pipe stdout/stderr into log files
    $script:OllamaOutJob = Register-ObjectEvent -InputObject $script:OllamaProc -EventName OutputDataReceived -Action {
        if ($null -ne $EventArgs.Data) {
            Add-Content -Path $Event.MessageData -Value $EventArgs.Data
        }
    } -MessageData $ollamaLog
    $script:OllamaErrJob = Register-ObjectEvent -InputObject $script:OllamaProc -EventName ErrorDataReceived -Action {
        if ($null -ne $EventArgs.Data) {
            Add-Content -Path $Event.MessageData -Value $EventArgs.Data
        }
    } -MessageData $ollamaErr
    $script:OllamaProc.BeginOutputReadLine()
    $script:OllamaProc.BeginErrorReadLine()

    $ready = $false
    for ($i = 0; $i -lt 25; $i++) {
        Start-Sleep -Seconds 1
        if (Test-OllamaApi) {
            $ready = $true
            break
        }
    }

    if ($ready) {
        Write-Host "[OK] Ollama ready (Vulkan preferred)" -ForegroundColor Green
        Write-LauncherLog "Ollama ready"
        try {
            $tagResponse = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5
            $models = @($tagResponse.models | ForEach-Object { $_.name })
            Write-Host "     Models: $($models -join ', ')" -ForegroundColor Gray
            Write-LauncherLog ("Models: " + ($models -join ", "))
        }
        catch { }
    }
    else {
        Write-Host "[!] Ollama did not become ready in time. See logs\ollama.log" -ForegroundColor Yellow
        Write-LauncherLog "Ollama failed to become ready"
    }
}

function Start-LoggedCmd {
    param(
        [string]$Title,
        [string]$CommandLine,
        [string]$LogFileName
    )
    $logPath = Join-Path $LogDir $LogFileName
    "" | Set-Content -Path $logPath -Encoding utf8
    # cmd /c with append so child tools keep writing after start
    $arg = "/c $CommandLine >> `"$logPath`" 2>&1"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    $psi.Arguments = $arg
    $psi.WorkingDirectory = $Root
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    Write-LauncherLog "$Title started pid=$($proc.Id) log=$LogFileName"
    return $proc
}

function Start-AppServers {
    Write-Host "[2/3] FastAPI backend :5000..." -ForegroundColor Cyan
    $script:BackendProc = Start-LoggedCmd -Title "Backend" -CommandLine "uv run server.py" -LogFileName "backend.log"

    Write-Host "[3/3] Vite frontend :3000..." -ForegroundColor Cyan
    $script:FrontendProc = Start-LoggedCmd -Title "Frontend" -CommandLine "npm run dev" -LogFileName "frontend.log"
}

function Open-AppWhenReady {
    $url = "http://localhost:3000/"
    Write-Host ""
    Write-Host "Waiting for frontend..." -ForegroundColor Gray
    $opened = $false
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) {
                Start-Process $url
                $opened = $true
                break
            }
        }
        catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $opened) {
        Write-Host "[i] Opening browser anyway: $url" -ForegroundColor Gray
        Start-Process $url
    }
}

function Wait-UntilServersExit {
    while ($true) {
        $frontAlive = $false
        $backAlive = $false
        if ($null -ne $script:FrontendProc) {
            $frontAlive = -not $script:FrontendProc.HasExited
        }
        if ($null -ne $script:BackendProc) {
            $backAlive = -not $script:BackendProc.HasExited
        }
        if (-not $frontAlive -and -not $backAlive) {
            Write-Host "App servers exited." -ForegroundColor Yellow
            Write-LauncherLog "App servers exited"
            break
        }
        Start-Sleep -Seconds 2
    }
}

# Console close / Ctrl+C handler
try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PdfZenConsole {
  public delegate bool HandlerRoutine(int dwCtrlType);
  [DllImport("Kernel32")]
  public static extern bool SetConsoleCtrlHandler(HandlerRoutine Handler, bool Add);
}
'@
    $script:CtrlHandler = [PdfZenConsole+HandlerRoutine] {
        param([int]$ctrlType)
        if ($ctrlType -eq 0 -or $ctrlType -eq 2 -or $ctrlType -eq 5 -or $ctrlType -eq 6) {
            Invoke-Cleanup
            return $true
        }
        return $false
    }
    [void][PdfZenConsole]::SetConsoleCtrlHandler($script:CtrlHandler, $true)
}
catch {
    Write-Host "[i] Console close hook unavailable; use Ctrl+C for clean shutdown if needed." -ForegroundColor DarkYellow
}

try {
    Start-OllamaVulkan
    Write-Host ""
    Start-AppServers
    Open-AppWhenReady

    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host " PDFZen is running" -ForegroundColor Green
    Write-Host "  Frontend:  http://localhost:3000/" -ForegroundColor Gray
    Write-Host "  Backend:   http://localhost:5000/" -ForegroundColor Gray
    Write-Host "  Ollama:    http://127.0.0.1:11434 (Vulkan iGPU)" -ForegroundColor Gray
    Write-Host "  Logs:      $LogDir" -ForegroundColor Cyan
    Write-Host "             (also: Settings gear → Service logs)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host " Close THIS window or press Ctrl+C to stop" -ForegroundColor Yellow
    Write-Host " everything (backend, frontend, Ollama)." -ForegroundColor Yellow
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host ""
    Write-LauncherLog "All services running"

    Wait-UntilServersExit
}
catch {
    Write-Host "[!] Launcher error: $($_.Exception.Message)" -ForegroundColor Red
    Write-LauncherLog "Launcher error: $($_.Exception.Message)"
}
finally {
    Invoke-Cleanup
}
