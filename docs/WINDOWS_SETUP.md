# Windows setup and checks (PowerShell)

Run every command from the repository root (`FocusLock\`) unless a step says otherwise. The demo accounts and the local `.env` are for development only; never enter real student data.

## 1. Start the stack with Docker

Requires Docker Desktop with Compose.

```powershell
Copy-Item .env.example .env          # first time only; edit DEV_PASSWORD if you like
docker compose up --build -d
docker compose ps                    # db, api and dashboard should be "healthy"/"running"
```

Dashboard: <http://localhost:5173> · API docs: <http://localhost:8000/docs>. Sign in as `teacher@focuslock.test` with `DEV_PASSWORD` from `.env`.

After changing backend or dashboard code: `docker compose up -d --build api dashboard`. To reset the demo data (the seeded classes expire): `docker compose down --volumes; docker compose up --build -d`.

## 2. Verify API health

```powershell
Invoke-RestMethod http://localhost:8000/health/live     # status: ok
Invoke-RestMethod http://localhost:8000/health/ready    # status: ready (fails closed if migrations or config are missing)
```

## 3. Without Docker (SQLite, local only)

Requires Python 3.12+ and Node 22.12+. SQLite does not exercise PostgreSQL-specific locking; use Docker or CI for that.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:APP_ENV = "development"; $env:ENABLE_DEV_AUTH = "true"; $env:DEV_PASSWORD = "local-demo-only"
$env:QR_SIGNING_KEY = "local-qr-signing-key-change-before-deployment-2026"
$env:POLICY_SIGNING_KEY = "local-policy-signing-key-change-before-deployment-2026"
$env:BLE_TOKEN_KEY = "local-ble-key-change-before-deployment-2026"
$env:DEV_RECEIVER_TOKEN = "local-receiver-token"
$env:RESOURCE_ALLOWED_HOSTS = "college.example.edu,docs.college.example.edu"
alembic upgrade head
python -m app.seed
# Or skip the two lines above with mock data, rebuilt on every start: $env:MOCK_DATA = "true"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

In a second PowerShell window:

```powershell
cd dashboard
npm ci
npm run dev                          # http://localhost:5173, proxies /api to 127.0.0.1:8000
```

If the dashboard shows `Request failed (502)`, the API is not running on port 8000.

## 4. Android SDK and JAVA_HOME

Install Android Studio (it bundles a JDK) and, in SDK Manager, Android SDK Platform 35 and Platform-Tools. Then, per PowerShell session:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
java -version                        # 17 or 21
Set-Content android\local.properties ("sdk.dir=" + ($env:ANDROID_HOME -replace '\\', '\\'))
```

`android\local.properties` is ignored by Git; recreate it on each machine.

## 5. Phone over USB

Enable Developer options and USB debugging on the phone, connect it, and accept the debugging prompt.

```powershell
adb devices                          # the phone must show as "device", not "unauthorized"
adb reverse tcp:8000 tcp:8000        # phone's 127.0.0.1:8000 -> this PC's API; repeat after replugging
cd android
.\gradlew.bat :app:assembleDebug -PAPI_BASE_URL=http://127.0.0.1:8000
adb install -r app\build\outputs\apk\debug\app-debug.apk
adb shell am start -n org.focuslock.app/.MainActivity
```

On the emulator, skip `adb reverse` and omit `-PAPI_BASE_URL` (the debug default is `http://10.0.2.2:8000`). Optional experimental features stay off unless you add `-PENABLE_LOCAL_VPN=true -PENABLE_BLE_PRESENCE=true`; do not distribute such builds.

FocusLock sets `FLAG_SECURE`, so Android blocks screenshots and screen recordings of the app; that is expected.

## 6. Checks

```powershell
cd backend;   python -m pytest -q
cd ..\dashboard; npm ci; npm run build          # TypeScript check + production build
cd ..\android;   .\gradlew.bat :app:assembleDebug :app:lintDebug :app:testDebugUnitTest :app:compileReleaseKotlin
.\gradlew.bat :app:compileDebugKotlin -PENABLE_LOCAL_VPN=true -PENABLE_BLE_PRESENCE=true
```

With Compose running: `docker compose exec api alembic check` and `docker compose exec api python -m scripts.smoke` on a fresh demo database.
