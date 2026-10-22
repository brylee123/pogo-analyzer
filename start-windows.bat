@echo off
setlocal
cd /d "%~dp0"
title PokeGO Analyzer
where py >nul 2>nul
if not errorlevel 1 (set "PY=py -3") else (set "PY=python")
%PY% --version >nul 2>nul
if errorlevel 1 (
 echo Install Python 3.11 or newer and enable PATH.
 pause
 exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
 %PY% -m venv .venv
 if errorlevel 1 goto failed
)
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto failed
echo Starting PokeGO Analyzer on http://127.0.0.1:6090
start "" "http://127.0.0.1:6090/"
".venv\Scripts\python.exe" app.py
pause
exit /b 0
:failed
echo Setup failed. Review error above.
pause
exit /b 1
