@echo off
REM StickyNotes Electron 启动脚本
REM 清除可能导致问题的环境变量
set ELECTRON_RUN_AS_NODE=

REM 添加 nvm-windows 的 nodejs 路径
set PATH=C:\nvm4w\nodejs;%PATH%

REM 启动应用
cd /d "%~dp0"
npm start
