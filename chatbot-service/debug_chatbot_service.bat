@echo off
setlocal

if not exist "%~dp0.venv\Scripts\python.exe" (
  echo Chatbot virtual environment not found.
  echo Run: py -m venv "%~dp0.venv"
  echo Then: "%~dp0.venv\Scripts\python.exe" -m pip install -r "%~dp0requirements.txt"
  exit /b 1
)

pushd "%~dp0"
set "CHATBOT_RELOAD=true"
set "CHATBOT_LOG_LEVEL=debug"
"%~dp0.venv\Scripts\python.exe" -m app.launcher
set "EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %EXIT_CODE%
