@echo off
REM Start ml-service with proper environment
cd /d "D:\VS Code Folder\dsa-platform"
call .venv\Scripts\activate.bat
cd ml-service
python app.py
