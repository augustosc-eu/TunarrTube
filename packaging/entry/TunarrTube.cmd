@echo off
rem Starts TunarrTube from the portable release (Windows): double-click it, or run it from a terminal.
rem Options: TunarrTube.cmd --help
setlocal
"%~dp0runtime\node.exe" "%~dp0launcher\launcher.mjs" %*
set EXITCODE=%ERRORLEVEL%
rem Keep a double-clicked window open on failure so the error stays readable.
if not "%EXITCODE%"=="0" pause
exit /b %EXITCODE%
