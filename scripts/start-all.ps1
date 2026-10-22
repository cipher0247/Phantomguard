# Starts the backend plus every configured model service, wiring PG_*_MODEL_URL for you.
#   powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1 [-Build] [-Mock]
# -Build : run `npm run build` first.   -Mock : if there is no trained text model, fall back to the labelled MOCK service (demo only).
# Audio/video may use experimental models with weak evaluation results; the app labels those results clearly.
# Model services bind to 127.0.0.1; only the backend (0.0.0.0:8787) is reachable from the phone. Stop everything with Ctrl+C.
param([switch]$Build, [switch]$Mock)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$py = 'ml\.venv\Scripts\python.exe'
if ($Build) { npm run build; if ($LASTEXITCODE) { exit $LASTEXITCODE } }
$procs = @()
$services = @()
function Start-Service-If([string]$name, [string]$artifact, [string]$script, [int]$port, [string]$envVar) {
  if ((Test-Path $py) -and (Test-Path $artifact)) {
    $p = Start-Process -FilePath $py -ArgumentList $script, '--port', $port -PassThru -WindowStyle Hidden
    $script:procs += $p
    $script:services += [pscustomobject]@{ name = $name; port = $port; process = $p }
    Set-Item "env:$envVar" "http://127.0.0.1:$port/predict"
    Write-Host "[$name] started on 127.0.0.1:$port (pid $($p.Id))"
  } else { Write-Host "[$name] not started: trained artifacts or Python venv missing ($artifact)" -ForegroundColor Yellow }
}
Start-Service-If 'text'  'ml\text\artifacts\model.joblib'  'ml\text\serve.py'  9100 'PG_TEXT_MODEL_URL'
Start-Service-If 'audio' 'ml\audio\pretrained.json' 'ml\audio\serve.py' 9200 'PG_AUDIO_MODEL_URL'
Start-Service-If 'video' 'ml\video\config.json'            'ml\video\serve.py' 9300 'PG_VIDEO_MODEL_URL'
if (-not $env:PG_TEXT_MODEL_URL -and $Mock) {
  $m = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'mock:text' -PassThru -WindowStyle Hidden; $procs += $m
  $env:PG_TEXT_MODEL_URL = 'http://127.0.0.1:9001/predict'; $env:PG_DEMO_MODE = '1'
  Write-Host '[text] using the labelled MOCK service (demo mode on)' -ForegroundColor Yellow
}
try {
  foreach ($service in $services) {
    $healthUrl = "http://127.0.0.1:$($service.port)/health"
    $ready = $false
    $lastError = 'health check did not respond'
    for ($i = 0; $i -lt 180; $i++) {
      if ($service.process.HasExited) { throw "[$($service.name)] exited before becoming healthy (pid $($service.process.Id))." }
      try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        if ($health.ok) { $ready = $true; break }
        $lastError = 'health response did not contain ok=true'
      } catch { $lastError = $_.Exception.Message }
      Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw "[$($service.name)] did not become healthy at $healthUrl within 6 minutes. Last error: $lastError" }
    Write-Host "[$($service.name)] healthy"
  }
  npm start
} finally {
  foreach ($p in $procs) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
}
