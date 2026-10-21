@echo off
chcp 65001 >nul
title 山河城邑 · 安装 C++ 生成工具

:: 没有管理员权限时自动请求提升（双击即可，会弹一次 UAC）
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo 正在请求管理员权限...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo ============================================================
echo   山河城邑 · 安装 Visual Studio 生成工具
echo   内容：MSVC v143 编译器 + Windows 11 SDK（约 1.5~2GB）
echo   安装路径：C:\VSBuildTools
echo.
echo   请保持联网，窗口会自动跑完，中途不要关闭。
echo   装完后回来让 AI 继续构建 exe。
echo ============================================================
echo.

"C:\Program Files (x86)\Microsoft Visual Studio\Installer\setup.exe" install ^
  --productId Microsoft.VisualStudio.Product.BuildTools ^
  --channelId VisualStudio.17.Release ^
  --channelUri https://aka.ms/vs/17/release/channel ^
  --installPath C:\VSBuildTools ^
  --add Microsoft.VisualStudio.Workload.VCTools ^
  --includeRecommended ^
  --locale zh-CN ^
  --passive ^
  --norestart

echo.
echo ============================================================
echo   退出码 = %ERRORLEVEL%
echo   0 或 3010 = 成功（3010 表示需要重启）
echo ============================================================
pause
