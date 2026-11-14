@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" set "NODE=node"
if not exist "%~dp0campus_auto_run.js" goto missing
echo Starting campus run...
"%NODE%" "%~dp0campus_auto_run.js"
set "RC=%ERRORLEVEL%"
echo.
echo Exit code: %RC%
echo Log: %~dp0campus_auto_run.log
pause
exit /b %RC%
:missing
echo Missing campus_auto_run.js
pause
exit /b 1
