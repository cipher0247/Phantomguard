# One-time Android SDK setup for building the APK. Run in PowerShell from the repo root:  powershell -ExecutionPolicy Bypass -File scripts\android-setup.ps1
# The portable JDK 21 and SDK command-line tools live in %LOCALAPPDATA%\PhantomguardTools (no admin rights needed).
# The Android SDK licences are shown and must be accepted by YOU (type y); this script never accepts them on your behalf.
$t = "$env:LOCALAPPDATA\PhantomguardTools"
$env:JAVA_HOME = (Get-ChildItem "$t\jdk" -Directory | Select-Object -First 1).FullName
$env:ANDROID_HOME = "$t\sdk"
$sm = "$t\sdk\cmdline-tools\latest\bin\sdkmanager.bat"
& $sm --licenses                      # interactive: read each licence, answer y to accept
& $sm "platform-tools" "platforms;android-36" "build-tools;36.0.0"
"sdk.dir=" + ($env:ANDROID_HOME -replace '\\', '/') | Set-Content -Encoding ascii "android\local.properties"   # git-ignored by the Android template
Write-Host "Done. Now run: powershell -ExecutionPolicy Bypass -File scripts\android-build.ps1"
