# Builds the debug APK with the portable toolchain installed by android-setup.ps1.
#   powershell -ExecutionPolicy Bypass -File scripts\android-build.ps1
# Optional: $env:PG_LAN_HOST = "<your PC's LAN IP>" first, to allow cleartext http to that host (see docs/ANDROID_DEMO.md).
. "$PSScriptRoot\android-env.ps1"
Set-ToolchainEnv

Step "Verifying toolchain"
$ver = Get-NativeOutput "$env:JAVA_HOME\bin\java.exe" @('-version')
if ($LASTEXITCODE -ne 0 -or $ver -notmatch 'version "21\.') { Fail "JDK 21 not working. Run scripts\android-setup.ps1." }
if (-not (Test-Path (Join-Path $SdkDir 'licenses\android-sdk-license'))) { Fail "Android SDK licence not accepted. Run scripts\android-setup.ps1 and accept it." }
foreach ($m in @("platforms\android-36\android.jar", "build-tools\36.0.0\d8.bat", "platform-tools\adb.exe")) {
  if (-not (Test-Path (Join-Path $SdkDir $m))) { Fail "SDK component missing: $m. Run scripts\android-setup.ps1." }
}
Write-LocalProperties

Push-Location $RepoRoot
try {
  Step "Syncing web app into the Android project"
  Invoke-Native 'npm run android:sync' { npm run android:sync }
  Step "Building debug APK (first run downloads Gradle, which can take several minutes)"
  Push-Location android
  try { Invoke-Native 'gradlew assembleDebug' { .\gradlew.bat assembleDebug } } finally { Pop-Location }

  $apk = Join-Path $RepoRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
  if (-not (Test-Path $apk)) { Fail "Gradle reported success but $apk does not exist." }
  $size = (Get-Item $apk).Length
  if ($size -lt 1MB) { Fail "APK is suspiciously small ($size bytes)." }
  $debuggable = (Get-NativeOutput (Join-Path $SdkDir 'cmdline-tools\latest\bin\apkanalyzer.bat') @('manifest', 'debuggable', $apk)).Trim()
  Write-Host "`nAPK BUILT: $apk" -ForegroundColor Green
  Write-Host ("Size: {0:N0} bytes ({1:N1} MB); debuggable: {2}" -f $size, ($size / 1MB), $debuggable)
  Write-Host "Install: adb install -r `"$apk`"  (phone connected, USB debugging on, authorised)"
} finally { Pop-Location }
