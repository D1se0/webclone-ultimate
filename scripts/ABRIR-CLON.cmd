@echo off
title WebClone Ultimate
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing
node abrir-clon.mjs %*
echo.
echo Servidor detenido.
pause
exit /b 0
:missing
echo.
echo WebClone Ultimate necesita Node.js 20 o superior.
echo Descargalo en https://nodejs.org/ y vuelve a ejecutar ABRIR-CLON.cmd.
echo.
pause
exit /b 1
