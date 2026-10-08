@echo off
rem Build, start the local server (minimized), then open the display in an Edge app window.
cd /d "%~dp0"

if not exist node_modules call npm install --no-fund --no-audit
call npm run build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

rem If the server is already running, this second instance exits by itself (strictPort).
start "tenki-server" /min cmd /c "npm run preview -- --port 4173 --strictPort"
timeout /t 2 /nobreak >nul
start "" msedge --app=http://localhost:4173
