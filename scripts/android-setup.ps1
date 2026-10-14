# One-time Android toolchain setup. From the repo root:
#   powershell -ExecutionPolicy Bypass -File scripts\android-setup.ps1 [-ToolsOnly] [-Persist]
# Installs a portable JDK 21 + Android command-line tools + SDK packages into %LOCALAPPDATA%\PhantomguardTools (no admin, nothing system-wide).
# -ToolsOnly : stop after JDK + command-line tools are verified (no licences, no SDK packages).
# -Persist   : also save JAVA_HOME / ANDROID_HOME / ANDROID_SDK_ROOT as USER environment variables (off by default; the build script sets them per run).
# Android SDK licences are shown by sdkmanager and must be accepted by you typing "y". This script never answers for you.
param([switch]$ToolsOnly, [switch]$Persist)
. "$PSScriptRoot\android-env.ps1"

Step "Checking disk space"
New-Item -ItemType Directory -Force $Tools | Out-Null
Test-DiskSpace 4

# ---- JDK 21 -------------------------------------------------------------------------------------------------------
$jh = Find-Jdk
if ($jh) { $v = Get-NativeOutput "$jh\bin\java.exe" @('-version'); if ($v -notmatch 'version "21\.') { Write-Host "Existing JDK is not 21; replacing."; Remove-Item $JdkDir -Recurse -Force; $jh = $null } }
if (-not $jh) {
  $zip = Get-Archive 'JDK 21 (Temurin)' $JdkUrl @('jdk21*.zip', 'OpenJDK21*.zip', 'OpenJDK21U-jdk_x64_windows*.zip') '*/bin/java.exe' 150MB (Join-Path $Tools 'jdk21.zip')
  # Checksum: Adoptium publishes <binary url>.sha256.txt next to each binary (checked only for archives downloaded from it).
  if ($zip -eq (Join-Path $Tools 'jdk21.zip') -and -not $env:PG_JDK_URL) {
    $expected = $null
    try {
      $loc = Get-RedirectLocation $JdkUrl
      if ($loc) { $expected = ((Invoke-WebRequest -Uri "$loc.sha256.txt" -UseBasicParsing -ErrorAction Stop).Content.ToString() -split 's+')[0].ToLower() }
    } catch { $expected = $null }
    if (-not $expected) { Write-Host "WARNING: could not fetch the JDK checksum; relying on the archive integrity check only." -ForegroundColor Yellow }
    else {
      $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
      if ($expected -ne $actual) { Remove-Item $zip -Force; Fail "JDK checksum mismatch (expected $expected, got $actual). The archive was deleted; re-run to retry." }
      Write-Host "JDK SHA-256 verified."
    }
  }
  Step "Extracting JDK"
  Remove-Item $JdkDir -Recurse -Force -ErrorAction SilentlyContinue
  try { Expand-Archive -Path $zip -DestinationPath $JdkDir -Force } catch { Fail "JDK archive is corrupt ($($_.Exception.Message)). Delete $zip and re-run." }
  $jh = Find-Jdk
}
if (-not $jh) { Fail "JDK extraction finished but bin\java.exe was not found under $JdkDir." }
$ver = Get-NativeOutput "$jh\bin\java.exe" @('-version')
if ($LASTEXITCODE -ne 0 -or $ver -notmatch 'version "21\.') { Fail "java.exe did not report version 21: $ver" }
Write-Host "JDK OK: $jh"

# ---- Android command-line tools -----------------------------------------------------------------------------------
if (-not (Test-Path $SdkManager)) {
  $zip = Get-Archive 'Android command-line tools' $CmdToolsUrl @('commandlinetools-win-*_latest.zip') 'cmdline-tools/bin/sdkmanager.bat' 100MB (Join-Path $Tools $CmdToolsName)
  Step "Extracting command-line tools into cmdline-tools\latest"
  $tmp = Join-Path $Tools 'cmdtools-extract'
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  try { Expand-Archive -Path $zip -DestinationPath $tmp -Force } catch { Fail "Command-line tools archive is corrupt ($($_.Exception.Message)). Delete $zip and re-run." }
  if (-not (Test-Path (Join-Path $tmp 'cmdline-tools\bin\sdkmanager.bat'))) { Fail "Unexpected archive layout: cmdline-tools\bin\sdkmanager.bat not found in $zip." }
  New-Item -ItemType Directory -Force (Join-Path $SdkDir 'cmdline-tools') | Out-Null
  Remove-Item (Join-Path $SdkDir 'cmdline-tools\latest') -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item (Join-Path $tmp 'cmdline-tools') (Join-Path $SdkDir 'cmdline-tools\latest')
  Remove-Item $tmp -Recurse -Force
}
if (-not (Test-Path $SdkManager)) { Fail "sdkmanager.bat not found at $SdkManager after extraction." }
Set-ToolchainEnv
$smv = (Get-NativeOutput $SdkManager @('--version')).Trim()
if ($LASTEXITCODE -ne 0 -or -not $smv) { Fail "sdkmanager could not run (exit $LASTEXITCODE): $smv" }
Write-Host "sdkmanager OK: version $smv"

if ($ToolsOnly) {
  Write-Host "`nTools verified (JDK 21 + sdkmanager). Licences NOT accepted and SDK packages NOT installed (-ToolsOnly)." -ForegroundColor Yellow
  exit 0
}

# ---- Licences (interactive: you must type y) ----------------------------------------------------------------------
Step "Android SDK licences: read each one and type y to accept (or n to refuse)"
& $SdkManager --licenses
if ($LASTEXITCODE -ne 0) { Fail "sdkmanager --licenses failed (exit $LASTEXITCODE). Check your network/proxy and re-run." }
$lic = Join-Path $SdkDir 'licenses\android-sdk-license'
if (-not (Test-Path $lic)) { Fail "The Android SDK licence was not accepted ($lic is missing). The SDK cannot be installed without it. Re-run this script and accept the licence." }

# ---- SDK packages -------------------------------------------------------------------------------------------------
Step "Installing SDK packages: $($Packages -join ', ')"
& $SdkManager --install @Packages
if ($LASTEXITCODE -ne 0) { Fail "sdkmanager --install failed (exit $LASTEXITCODE). Check your network/proxy and free disk space, then re-run." }
$must = @("platform-tools\adb.exe", "platforms\android-36\android.jar", "build-tools\36.0.0\d8.bat")
foreach ($m in $must) { if (-not (Test-Path (Join-Path $SdkDir $m))) { Fail "Expected file missing after install: $SdkDir\$m" } }

Write-LocalProperties
if ($Persist) {
  [Environment]::SetEnvironmentVariable('JAVA_HOME', $env:JAVA_HOME, 'User')
  [Environment]::SetEnvironmentVariable('ANDROID_HOME', $SdkDir, 'User')
  [Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', $SdkDir, 'User')
  Write-Host "Saved JAVA_HOME / ANDROID_HOME / ANDROID_SDK_ROOT as user environment variables (open a new terminal to see them)."
}
Write-Host "`nSetup complete and verified. Next: powershell -ExecutionPolicy Bypass -File scripts\android-build.ps1" -ForegroundColor Green
