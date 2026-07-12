# Start (or restart) Ollama with Vulkan so iGPU acceleration is preferred.
# Note: Ollama does not use Windows NPUs; Vulkan/iGPU is the supported local accel path.

$ErrorActionPreference = "Continue"

$env:OLLAMA_VULKAN = "1"
$env:OLLAMA_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,*"
$env:OLLAMA_FLASH_ATTENTION = "1"
# Prefer first Vulkan device (usually iGPU when no discrete GPU, or list index 0)
if (-not $env:GGML_VK_VISIBLE_DEVICES) {
    $env:GGML_VK_VISIBLE_DEVICES = "0"
}

function Test-OllamaApi {
    try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2
        return $true
    } catch {
        return $false
    }
}

$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
$ollamaExe = if ($ollamaCmd) {
    $ollamaCmd.Source
} elseif (Test-Path "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe") {
    "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
} else {
    $null
}

if (-not $ollamaExe) {
    Write-Host "[!] Ollama not found on PATH or in LocalAppData. Skipping AI server start." -ForegroundColor Yellow
    Write-Host "    Install from https://ollama.com/download then re-run start.bat" -ForegroundColor Yellow
    exit 0
}

Write-Host "Starting Ollama with Vulkan (iGPU)..." -ForegroundColor Cyan
Write-Host "  OLLAMA_VULKAN=1" -ForegroundColor Gray
Write-Host "  GGML_VK_VISIBLE_DEVICES=$($env:GGML_VK_VISIBLE_DEVICES)" -ForegroundColor Gray
Write-Host "  OLLAMA_ORIGINS=$($env:OLLAMA_ORIGINS)" -ForegroundColor Gray
Write-Host "  Note: Ollama does not accelerate on NPU; Vulkan iGPU is used instead." -ForegroundColor DarkYellow

# If API already up but we want Vulkan flags, restart the server process only when possible.
if (Test-OllamaApi) {
    Write-Host "[i] Ollama API already responding. Restarting so Vulkan env applies..." -ForegroundColor Gray
    Get-Process -Name "ollama","Ollama" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# Launch ollama serve in a new process with Vulkan env inherited
$serveArgs = "serve"
Start-Process -FilePath $ollamaExe -ArgumentList $serveArgs -WindowStyle Hidden

$ok = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    if (Test-OllamaApi) {
        $ok = $true
        break
    }
}

if ($ok) {
    Write-Host "[OK] Ollama is up at http://127.0.0.1:11434 (Vulkan preferred)" -ForegroundColor Green
    try {
        $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5
        $models = @($tags.models | ForEach-Object { $_.name })
        if ($models.Count -eq 0) {
            Write-Host "[!] No models installed. Pull with:" -ForegroundColor Yellow
            Write-Host "    ollama pull huihui_ai/qwen3-vl-abliterated:8b" -ForegroundColor Yellow
        } else {
            Write-Host "[i] Models: $($models -join ', ')" -ForegroundColor Gray
        }
    } catch { }
    exit 0
}

Write-Host "[!] Ollama did not become ready in time. AI Summarizer may fall back until you start Ollama manually." -ForegroundColor Yellow
exit 0
