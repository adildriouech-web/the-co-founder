@echo off
cd /d "%~dp0"
echo ============================================
echo   The Co-Founder - starting up
echo ============================================
echo.
echo Checking for Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Node.js is NOT installed on this computer.
  echo     1. Go to https://nodejs.org
  echo     2. Download and install the "LTS" version
  echo     3. Then double-click this file again
  echo.
  pause
  exit /b
)
echo Node found. Starting the app...
echo.
echo When you see "The Co-Founder is running", open this in your browser:
echo     http://localhost:3000
echo.
echo Keep this window open while you use the app. Close it to stop.
echo --------------------------------------------
echo.
node server.js
echo.
echo (The app has stopped.)
pause
