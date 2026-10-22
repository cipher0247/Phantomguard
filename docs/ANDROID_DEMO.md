# PHANTOMGUARD: Android demo guide

The Android app is the same React UI, bundled into an APK with Capacitor (`com.phantomguard.app`). The APK contains **no server address, keys or accounts**: you type the backend address into the app, and it is kept on the phone.

## 1. One-time toolchain setup (needed only to build the APK)

Capacitor 8 needs **JDK 21** and the **Android SDK (platform 36, build-tools)**. Gradle 8.14 is downloaded by the project's wrapper.

```powershell
winget install EclipseAdoptium.Temurin.21.JDK
winget install Google.AndroidStudio      # then: open it once → SDK Manager → install "Android 16 (API 36)" + Build-Tools, and accept the licences
```

Then (new terminal):

```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21..."   # path of the installed JDK
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```

Accepting the Android SDK licences is a manual step that cannot be automated on your behalf.

## 2. Start the backend on your PC

```powershell
npm install
npm run demo:setup                 # creates demo@phantomguard.local with a NEW random password, printed once (local only)
powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1
```

The launcher starts configured model services and waits for health checks before starting the backend on `0.0.0.0:8787`. It uses the experimental audio/video detectors described in `ml/README.md`; the app marks their results as experimental because their measured performance is weak. It does not enable mock text results unless you explicitly pass `-Mock`.

Without `PG_TEXT_MODEL_URL` the text screen reports "not configured" honestly. Demo mode refuses to start with `NODE_ENV=production`, and `demo:setup` refuses to run in production; the server also refuses to start in production while any `@phantomguard.local` account exists. Remove the demo account afterwards: `npm run delete-user -- demo@phantomguard.local`.

## 3. How the phone reaches the backend (pick one)

`localhost` on the phone is the phone, not your PC. Options:

**A. USB + adb reverse (simplest, no network config).** Enable USB debugging, plug in, then:
```bash
adb reverse tcp:8787 tcp:8787
```
In the app, set the server to `http://localhost:8787`.

**B. Same Wi-Fi (LAN).** Find your PC's IPv4 (`ipconfig`), allow inbound TCP 8787 in Windows Firewall for the Private profile, and **build the APK with that host allowed for cleartext** (Android blocks plain HTTP otherwise):
```powershell
$env:PG_LAN_HOST = "192.168.1.23"      # YOUR PC's IP, never committed
npm run android:apk
```
In the app, set the server to `http://192.168.1.23:8787`. Cleartext is allowed only for loopback and the host(s) you list; everything else must be HTTPS and TLS verification is never disabled. Plain HTTP is for a trusted home/lab network only.

**C. HTTPS (no cleartext at all).** Put the backend behind any HTTPS front (e.g. a Cloudflare/ngrok/Tailscale tunnel with a valid certificate) and enter its `https://…` address in the app. No rebuild needed.

The sign-in and Profile screens show **Server: Connected / Unreachable** with Retry and Change.

## 4. Build and install the APK

```powershell
npm run android:apk        # build web → generate network config → cap sync → gradlew assembleDebug
```
Output: `android\app\build\outputs\apk\debug\app-debug.apk`. Install on a USB-connected phone with `adb install -r android\app\build\outputs\apk\debug\app-debug.apk`, or copy the file to the phone and open it (allow "install unknown apps" for your file manager). It is a **debug-signed** build for your own phone.

Permissions: only `INTERNET`. File uploads use Android's system file picker (no storage permission). The microphone and camera are not used. Backups are disabled so the session token is not copied to cloud backups.

## 5. Demo script (about 5 minutes)

1. Launch: the PHANTOMGUARD intro plays (tap **Skip intro** to jump ahead; autoplay failure falls back to the logo and continues).
2. Sign in with the demo account. Point out **Server: Connected**.
3. Dashboard: "No scans yet" and service status are real. The **DEMO MODE** banner explains that results are MOCK.
4. Analyze → Text → tap a **Demo sample** → Execute scan. The result carries a **MOCK / DEMO RESULT** notice. The score only reflects message length; say so.
5. Open **View report**, then Alerts (mock results are never alerts) and Activity (history shows MOCK entries).
6. AI Advisor: without `ANTHROPIC_API_KEY` it says it is not configured; with a key, replies are labelled AI-generated.
7. Voice and Video tabs: uploads reach the experimental models; each result carries a prominent warning and limitations. Do not use the scores to make safety decisions. Profile: service status and privacy notes.

## 6. What is real vs. demo

| | State |
|---|---|
| Sign-in, sessions, history, reports, upload validation, connectivity status | Real |
| Text scan | Real only if you run a genuine model service at `PG_TEXT_MODEL_URL`; the optional bundled mock is labelled MOCK everywhere and excluded from risk figures |
| Audio, video | Experimental pretrained checkpoints; both have near-chance evaluation results and must not be trusted for decisions |
| Advisor | Real only with `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`; labelled AI-generated |

Not verified: physical-device or emulator testing of the APK. The web build was checked at 360 px width in a desktop browser.
