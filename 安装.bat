@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo Installing Fanzhuan Campus Run...
echo If a UAC prompt appears, click Yes.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_task.ps1"
echo.
pause
