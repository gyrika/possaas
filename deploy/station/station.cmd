@echo off
rem Lume POS: the shop server. Started by the "Lume POS" task when Windows starts
rem (as SYSTEM). If it ever stops, it starts again 5 seconds later.
rem Data (database, settings, logs, receipts in dry run): C:\ProgramData\LumePOS
rem Optional settings (the cloud copy, MySQL...): C:\ProgramData\LumePOS\station.env
setlocal
set DATA_DIR=%ProgramData%\LumePOS
if not exist "%DATA_DIR%\logs" mkdir "%DATA_DIR%\logs"
cd /d "%~dp0app"
:loop
echo [%date% %time%] starting >> "%DATA_DIR%\logs\server.log"
"%~dp0node\node.exe" --experimental-strip-types --no-warnings --env-file-if-exists="%DATA_DIR%\station.env" server\main.ts >> "%DATA_DIR%\logs\server.log" 2>&1
echo [%date% %time%] stopped (exit %errorlevel%), restarting in 5 s >> "%DATA_DIR%\logs\server.log"
timeout /t 5 /nobreak > nul
goto loop
