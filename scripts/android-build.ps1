# Builds the debug APK using the portable toolchain from android-setup.ps1.
# Optional: $env:PG_LAN_HOST = "<your PC's LAN IP>" before running, to allow cleartext http to that host (see docs/ANDROID_DEMO.md).
$t = "$env:LOCALAPPDATA\PhantomguardTools"
$env:JAVA_HOME = (Get-ChildItem "$t\jdk" -Directory | Select-Object -First 1).FullName
$env:ANDROID_HOME = "$t\sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
npm run android:sync; if ($LASTEXITCODE) { exit $LASTEXITCODE }
Push-Location android; .\gradlew.bat assembleDebug; $rc = $LASTEXITCODE; Pop-Location
if ($rc) { exit $rc }
Get-Item android\app\build\outputs\apk\debug\app-debug.apk | Select-Object FullName, Length
