@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title PokeGO Analyzer
echo =============================
echo   PokeGO Analyzer Launcher
echo =============================
where py >nul 2>nul
if not errorlevel 1 (
  set "PY=py -3"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo Python is not installed. Install Python 3.11 or newer, then rerun.
    pause
    exit /b 1
  )
  set "PY=python"
)
if not exist ".venv\Scripts\python.exe" (
  echo Creating Python environment...
  %PY% -m venv .venv
  if errorlevel 1 goto failed
)
echo Installing Python dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto failed
if not exist ".env" (
  echo Creating local configuration...
  ".venv\Scripts\python.exe" -c "import secrets,pathlib;p=pathlib.Path('.env');p.write_text('SECRET_KEY='+secrets.token_hex(48)+'\nHOST=127.0.0.1\nPORT=6090\nCOOKIE_SECURE=0\n')"
  if errorlevel 1 goto failed
)
echo Starting server at http://127.0.0.1:6090
start "" "http://127.0.0.1:6090/"
".venv\Scripts\python.exe" app.py
echo Server stopped.
pause
exit /b 0
:failed
echo Installation or startup failed. Review the error above.
pause
exit /b 1
