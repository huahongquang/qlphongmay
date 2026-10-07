# HỆ THỐNG QUẢN LÝ PHÒNG THI MÁY TÍNH (QUY MÔ 200 MÁY) & CHỐNG GIAN LẬN

Dự án được xây dựng và phát triển dựa trên tài liệu đặc tả `Ung_Dung_Phong_Thi_Day_Du.docx`, mở rộng quy mô từ mô hình mẫu lên **200 máy trạm** hoạt động đồng thời trong mạng nội bộ (LAN).

---

## 1. Các Tính Năng Nổi Bật

### 1.1. Quản lý Quy mô 200 Máy Trạm (Lab Grid & Rooms)
- **Sơ đồ ma trận 200 máy (Interactive Matrix Grid)**: Bố trí trực quan 200 ô máy tính (từ `PC-001` đến `PC-200`), chia theo 4 phòng:
  - **Phòng A (Tầng 1)**: PC-001 đến PC-050
  - **Phòng B (Tầng 1)**: PC-051 đến PC-100
  - **Phòng C (Tầng 2)**: PC-101 đến PC-150
  - **Phòng D (Tầng 2)**: PC-151 đến PC-200
- **Trạng thái thời gian thực qua WebSocket**:
  - 🟢 **Đã nộp bài (Submitted)**: Thí sinh đã nộp bài thành công lên máy chủ.
  - 🔵 **Đang trực tuyến (Online)**: Thí sinh đang mở máy và làm bài thi (Heartbeat 15s).
  - ⚪ **Chưa kết nối (Offline)**: Máy tính chưa bật hoặc chưa vào trang thi.
  - 🔴 **Cảnh báo vi phạm (Warning)**: Viền đỏ nhấp nháy phát hiện nghi vấn gian lận.

### 1.2. Cơ Chế Chống Gian Lận (Anti-Cheat Engine)
Theo đúng nguyên tắc ghi nhận bộ 3 thông tin: **Mã Sinh Viên (User ID)**, **Tên Máy Tính (Device Name)**, và **Địa Chỉ IP (IP Address)**:
1. **Phát hiện thi hộ / đổi máy**: Cảnh báo khi một Mã SV nộp bài hoặc kết nối từ máy/IP khác với máy đã đăng nhập trước đó.
2. **Phát hiện nộp bài hộ**: Cảnh báo khi một máy tính hoặc địa chỉ IP nộp bài cho nhiều Mã SV khác nhau.
3. **Ngăn chặn nộp bài từ xa (ngoài phòng thi)**: Tự động trích xuất IP của thí sinh qua request socket/HTTP, đối chiếu với dải IP mạng nội bộ của trường (`allowedIpPrefix`, ví dụ `192.168.1.*`). Nếu phát hiện IP lạ từ bên ngoài internet, hệ thống lập tức gắn cờ cảnh báo đỏ.

### 1.3. Giao Diện Máy Trạm (Client Thí Sinh)
- Thiết kế chuẩn UX/UI, thân thiện, dễ sử dụng.
- **Tự động nhận diện IP máy trạm**.
- Hỗ trợ kéo & thả file bài làm (drag & drop), hỗ trợ nén .zip, .rar, .docx, .cpp, .py, .java,... dung lượng tối đa 150MB.
- **Biên nhận điện tử (Submission Receipt)**: Sau khi nộp thành công, hệ thống xuất phiếu biên nhận ghi rõ Mã SV, Họ tên, Tên máy, IP, tên file đã lưu và thời gian nộp bài chính xác đến từng giây.

### 1.4. Bảng Điều Khiển Giám Thị (Teacher Dashboard)
- **Thống kê tổng quan (KPIs)**: Tổng máy (200), Online, Đã nộp bài, Chưa nộp bài, Số ca cảnh báo gian lận.
- **Khóa / Mở cổng nộp bài**: Giám thị chỉ cần 1 click để khóa cổng khi hết giờ làm bài.
- **Tải toàn bộ bài thi (.ZIP)**: Tải về một file ZIP duy nhất chứa toàn bộ bài làm của cả 200 thí sinh kèm file báo cáo tổng hợp `BaoCao_TongKet_PhongThi.json`.
### 1.5. Tự Động Lưu Bài Về Thư Mục Google Drive (Cloud Backup)
- **Đồng bộ thời gian thực**: Khi thí sinh nộp bài, tệp bài làm vừa được lưu trên máy chủ/bộ nhớ, vừa tự động tải thẳng vào thư mục Google Drive của giáo viên.
- **Không tốn phí & không cần thẻ tín dụng**: Sử dụng cơ chế Google Apps Script Webhook miễn phí 100%.
- **Xem trực tiếp từ Dashboard**: Trên bảng điều khiển giám thị, bên cạnh nút "Tải", xuất hiện nút "Drive" màu xanh lá giúp giám thị mở trực tiếp file trên Google Drive chỉ với 1 click.

---

## 2. Cấu Trúc Thư Mục Dự Án

```
d:/Project/QL_Phongmay/
├── data/
│   └── database.json          # Cơ sở dữ liệu lưu trữ 200 máy, bài thi, cảnh báo
├── uploads/                   # Thư mục lưu trữ các file bài nộp
├── public/
│   ├── css/
│   ├── js/
│   │   ├── client.js          # Logic phía máy trạm (heartbeat, nộp bài, biên nhận)
│   │   └── admin.js           # Logic phía giám thị (realtime websocket, sơ đồ 200 máy)
│   ├── index.html             # Giao diện nộp bài của thí sinh
│   └── admin.html             # Bảng điều khiển giám thị
├── server.js                  # Máy chủ Express + WebSocket + Multer + Archiver ZIP
├── db.js                      # Quản lý dữ liệu 200 máy và kỳ thi
├── antiCheat.js               # Động cơ phát hiện gian lận tự động
├── start.bat                  # File chạy nhanh 1-click trên Windows
├── package.json               # Cấu hình thư viện Node.js
└── README.md                  # Tài liệu hướng dẫn sử dụng
```

---

## 3. Hướng Dẫn Cài Đặt & Khởi Chạy

### Cách 1: Khởi Chạy 1-Click (Khuyên Dùng Trên Windows)
- Nhấp đúp chuột vào file `start.bat` trong thư mục dự án.
- Cửa sổ console sẽ tự động kiểm tra Node.js, cài thư viện và khởi động máy chủ.

### Cách 2: Khởi Chạy Bằng Lệnh (Terminal / PowerShell)
1. Mở PowerShell hoặc Command Prompt tại thư mục dự án `d:\Project\QL_Phongmay`:
   ```bash
   npm install
   ```
2. Khởi chạy máy chủ:
   ```bash
   node server.js
   ```

---

## 4. Hướng Dẫn Truy Cập Trong Mạng Phòng Thi

1. **Trên Máy Chủ (Giám Thị / Server)**:
   - Truy cập Bảng điều khiển giám thị:  
     👉 [http://localhost:3000/admin](http://localhost:3000/admin)
   - Truy cập Cổng nộp bài thử nghiệm:  
     👉 [http://localhost:3000/](http://localhost:3000/)

2. **Trên 200 Máy Trạm (Thí Sinh Trong Phòng Thi)**:
   - Khi máy chủ khởi động, màn hình console sẽ hiển thị địa chỉ IP mạng LAN của máy chủ (ví dụ `192.168.1.50`).
   - Các máy trạm mở trình duyệt web bất kỳ (Chrome, Edge, Firefox) và truy cập:  
     👉 `http://<IP_MAY_CHU>:3000/` (ví dụ `http://192.168.1.50:3000/`)
   - Thí sinh nhập **Mã Sinh Viên**, **Họ Tên**, chọn hoặc nhập **Tên Máy** (`PC-001` đến `PC-200`), kéo thả file và bấm **"Xác Nhận Nộp Bài Thi"**.
