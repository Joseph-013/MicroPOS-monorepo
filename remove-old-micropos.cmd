@echo off
rem Double-click to remove the first MicroPOS (1.0.0). Runs remove-old-micropos.ps1 next to this file.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0remove-old-micropos.ps1" %*
echo.
pause
