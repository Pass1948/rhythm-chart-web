@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Preview
where node >nul 2>nul
if errorlevel 1 (
  type tools\msg_no_node.txt
  pause
  exit /b 1
)
node tools\preview.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
