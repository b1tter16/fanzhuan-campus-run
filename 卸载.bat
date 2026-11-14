@echo off
chcp 65001 >nul
schtasks /Delete /TN "FanzhuanCampusRun" /F >nul 2>&1
del "%USERPROFILE%\Desktop\翻转校园跑自动刷.lnk" >nul 2>&1
rmdir /s /q "%LOCALAPPDATA%\FanzhuanAutoRun" >nul 2>&1
echo Removed scheduled task, desktop shortcut and install folder.
pause
