# Shared helpers for android-setup.ps1 / android-build.ps1 (dot-sourced). No admin rights, no system-wide installs.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:Tools = Join-Path $env:LOCALAPPDATA 'PhantomguardTools'
$script:SdkDir = Join-Path $Tools 'sdk'
$script:JdkDir = Join-Path $Tools 'jdk'
$script:SdkManager = Join-Path $SdkDir 'cmdline-tools\latest\bin\sdkmanager.bat'
$script:RepoRoot = Split-Path -Parent $PSScriptRoot

# Download URLs (override with env vars if a mirror is needed).
$script:JdkUrl = if ($env:PG_JDK_URL) { $env:PG_JDK_URL } else { 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse' }
$script:CmdToolsName = 'commandlinetools-win-11076708_latest.zip'
$script:CmdToolsUrl = if ($env:PG_CMDTOOLS_URL) { $env:PG_CMDTOOLS_URL } else { "https://dl.google.com/android/repository/$CmdToolsName" }
$script:Packages = @('platform-tools', 'platforms;android-36', 'build-tools;36.0.0')

function Fail([string]$msg) { Write-Host "`nERROR: $msg" -ForegroundColor Red; exit 1 }
function Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

# Runs a native command; any non-zero exit code aborts the script.
function Invoke-Native([string]$what, [scriptblock]$cmd) {
  & $cmd
  if ($LASTEXITCODE -ne 0) { Fail "$what failed (exit code $LASTEXITCODE)." }
}

# Returns the redirect target of a URL without following it (Windows PowerShell throws on 3xx when redirects are disabled).
function Get-RedirectLocation([string]$u) {
  try { $r = Invoke-WebRequest -Uri $u -Method Head -MaximumRedirection 0 -UseBasicParsing -ErrorAction Stop; if ($r.Headers['Location']) { return [string]$r.Headers['Location'] }; return $null }
  catch { $r = $_.Exception.Response; if ($r -and $r.Headers['Location']) { return [string]$r.Headers['Location'] }; return $null }
}

# Captures stdout+stderr of a native tool (java -version writes to stderr, which Windows PowerShell 5.1 turns into an error under Stop).
function Get-NativeOutput([string]$exe, [string[]]$arguments) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { return (& $exe @arguments 2>&1 | ForEach-Object { "$_" } | Out-String) } finally { $ErrorActionPreference = $old }
}

function Test-DiskSpace([int]$neededGb) {
  $drive = (Get-Item $env:LOCALAPPDATA).PSDrive
  $freeGb = [math]::Floor($drive.Free / 1GB)
  if ($freeGb -lt $neededGb) { Fail "Only $freeGb GB free on $($drive.Name): but about $neededGb GB are needed for the JDK, Android SDK and Gradle caches. Free some space and re-run." }
}

function Find-Jdk { Get-ChildItem $JdkDir -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName 'bin\java.exe') } | Select-Object -First 1 -ExpandProperty FullName }

function Test-Zip([string]$path, [string]$mustContain, [long]$minBytes) {
  if (-not (Test-Path $path)) { return $false }
  if ((Get-Item $path).Length -lt $minBytes) { return $false }
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::OpenRead($path)
    try { return [bool]($z.Entries | Where-Object { $_.FullName -like $mustContain }) } finally { $z.Dispose() }
  } catch { return $false }
}

# Uses an existing verified archive (tools dir or Downloads) before downloading anything.
function Get-Archive([string]$label, [string]$url, [string[]]$candidateNames, [string]$mustContain, [long]$minBytes, [string]$dest) {
  $dirs = @($Tools, (Join-Path $env:USERPROFILE 'Downloads'))
  foreach ($d in $dirs) { foreach ($n in $candidateNames) {
    foreach ($f in (Get-ChildItem -Path $d -Filter $n -File -ErrorAction SilentlyContinue)) {
      if (Test-Zip $f.FullName $mustContain $minBytes) { Write-Host "Using existing $label archive: $($f.FullName)"; return $f.FullName }
    } } }
  Step "Downloading $label"
  Write-Host "    $url"
  try {
    $r = Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -PassThru -ErrorAction Stop
    if ($r.StatusCode -ne 200) { Fail "$label download returned HTTP $($r.StatusCode)." }
  } catch {
    Remove-Item $dest -Force -ErrorAction SilentlyContinue
    $m = $_.Exception.Message
    if ($m -match 'proxy|407') { Fail "Download of $label was blocked by a proxy ($m). Set HTTPS_PROXY / configure the system proxy, or download it manually: $url -> save as $dest" }
    if ($m -match 'space|disk') { Fail "Not enough disk space while downloading $label ($m)." }
    Fail "Could not download $label ($m). If this network blocks it, download it manually from $url and save it as $dest, then re-run."
  }
  if (-not (Test-Zip $dest $mustContain $minBytes)) { Remove-Item $dest -Force -ErrorAction SilentlyContinue; Fail "The downloaded $label archive is malformed or incomplete (expected an entry matching '$mustContain'). It was deleted; re-run to retry." }
  return $dest
}

function Set-ToolchainEnv {
  $jh = Find-Jdk
  if (-not $jh) { Fail "JDK not found under $JdkDir. Run scripts\android-setup.ps1 first." }
  $env:JAVA_HOME = $jh
  $env:ANDROID_HOME = $SdkDir
  $env:ANDROID_SDK_ROOT = $SdkDir
  $env:Path = "$jh\bin;$SdkDir\platform-tools;$SdkDir\cmdline-tools\latest\bin;$env:Path"
}

function Write-LocalProperties {
  $p = Join-Path $RepoRoot 'android\local.properties'
  $line = 'sdk.dir=' + ($SdkDir -replace '\\', '/')
  if (-not (Test-Path $p) -or (Get-Content $p -Raw) -notmatch [regex]::Escape($line)) { Set-Content -Path $p -Value $line -Encoding ascii }
}
