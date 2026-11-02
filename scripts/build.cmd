@echo off
rem Builds the release exe: src-tauri\target\release\raw-reader.exe
rem Needs Rust (https://rustup.rs) and the "Desktop development with C++" workload of the Visual Studio Build Tools.
setlocal

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo Visual Studio Build Tools were not found. Install them with the C++ workload, then run this again.
  exit /b 1
)
for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSROOT=%%i"
if not defined VSROOT (
  echo The C++ build tools are missing. Add the "Desktop development with C++" workload in the Visual Studio Installer.
  exit /b 1
)

call "%VSROOT%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1
set "PATH=%PATH%;%USERPROFILE%\.cargo\bin"

cd /d "%~dp0..\src-tauri"
cargo build --release
