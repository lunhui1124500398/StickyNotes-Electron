@echo off
setlocal
chcp 65001 >nul

echo ==========================================
echo 正在检查运行环境...
echo ==========================================

:: 检查 Node.js 是否安装
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js。
    echo 请访问 https://nodejs.org/ 下载并安装。
    pause
    exit /b
)

:: 检查 node_modules 是否存在
if not exist "node_modules" (
    echo [信息]以此目录未发现依赖包，正在为您安装依赖...
    echo 这可能需要几分钟时间，取决于您的网络状况。
    echo 正在执行: npm install
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败。
        echo 请检查网络连接或尝试手动运行 npm install。
        pause
        exit /b
    )
    echo [成功] 依赖安装完成。
)

echo ==========================================
echo 正在启动 StickyNotes...
echo ==========================================

:: 启动应用
call npm start

if %errorlevel% neq 0 (
    echo [错误] 应用启动失败。
    pause
)
