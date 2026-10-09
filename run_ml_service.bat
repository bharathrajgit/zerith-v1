@echo off
REM Start the ML service with its own Python environment.
if not exist "%~dp0ml-service\venv\Scripts\activate.bat" (
    echo ML service virtual environment not found at "%~dp0ml-service\venv".
    exit /b 1
)

call "%~dp0ml-service\venv\Scripts\activate.bat"
if errorlevel 1 (
    echo Failed to activate the ML service virtual environment.
    exit /b 1
)

cd /d "%~dp0ml-service"
python app.py
