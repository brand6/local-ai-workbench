@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%scripts\setup-agents-cli.ps1"

if not exist "%PS_SCRIPT%" (
  echo Missing helper script: %PS_SCRIPT%
  exit /b 1
)

set "PS_ARGS="

:parse_args
if "%~1"=="" goto run_script
if /I "%~1"=="--dry-run" (
  set "PS_ARGS=%PS_ARGS% -DryRun"
) else if /I "%~1"=="--force" (
  set "PS_ARGS=%PS_ARGS% -Force"
) else (
  echo Unknown argument: %~1
  echo Usage: setup-agents-cli.bat [--dry-run] [--force]
  exit /b 1
)
shift
goto parse_args

:run_script
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %PS_ARGS%
exit /b %ERRORLEVEL%
