@echo off
setlocal
title Openjutsu
cd /d "%~dp0"

if not exist ".venv-proxy\Scripts\comfy-api-proxy.exe" (
    echo Installing comfy-api-proxy...
    python -m venv .venv-proxy || goto :fail
    ".venv-proxy\Scripts\python.exe" -m pip install comfy-api-proxy || goto :fail
)
if not exist "node_modules" (
    echo Installing the app...
    call npm ci || goto :fail
)
if not exist ".env.local" copy ".env.example" ".env.local" >nul

curl -s -o nul -m 3 http://127.0.0.1:8188/queue
if errorlevel 1 echo Waiting for ComfyUI on 127.0.0.1:8188. Start it now.
:comfy
curl -s -o nul -m 3 http://127.0.0.1:8188/queue
if errorlevel 1 (
    timeout /t 3 /nobreak >nul
    goto :comfy
)

start "Openjutsu proxy" ".venv-proxy\Scripts\comfy-api-proxy.exe" run --max-upload-mb 500
start "Openjutsu app" cmd /c npm run dev

echo Starting Openjutsu...
:app
timeout /t 2 /nobreak >nul
curl -s -o nul -m 30 http://127.0.0.1:3000/
if errorlevel 1 goto :app
start "" http://127.0.0.1:3000
echo Openjutsu is running at http://127.0.0.1:3000
echo To stop it, close the "Openjutsu proxy" and "Openjutsu app" windows.
timeout /t 5 >nul
exit /b 0

:fail
echo Setup failed, see the messages above.
pause
exit /b 1
