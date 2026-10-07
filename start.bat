@echo off
chcp 65001 > nul
title HE THONG QUAN LY PHONG THI 200 MAY TINH
cls
echo =========================================================================
echo       HỆ THỐNG QUẢN LÝ PHÒNG THI 200 MÁY TÍNH & CHỐNG GIAN LẬN
echo =========================================================================
echo.
echo [1] Đang kiểm tra môi trường Node.js...
node -v > nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] May tinh chua cai dat Node.js! Vui long tai va cai dat tu https://nodejs.org
    pause
    exit /b
)

echo [2] Đang kiểm tra và giải phóng Cổng 3000 nếu đang bị chiếm dụng...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo [THONG BAO] Phat hien tien trinh PID %%a dang chiem cong 3000. Dang giai phong...
    taskkill /F /PID %%a > nul 2>&1
)

echo [3] Đang khởi động máy chủ phòng thi...
echo.
node server.js

pause
