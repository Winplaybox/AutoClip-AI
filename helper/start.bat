@echo off
title AutoClip Helper
cd /d "%~dp0"
where py >nul 2>nul || (echo Python is required: https://www.python.org/downloads/ & pause & exit /b 1)
py -m pip install --quiet --upgrade yt-dlp
if "%~1"=="" (py autoclip_helper.py) else (py autoclip_helper.py --browser %1)
pause
