const express = require('express');
const multer = require('multer');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const archiver = require('archiver');
const { getDB, saveDB } = require('./db');
const { checkAntiCheat } = require('./antiCheat');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true' || !!process.env.NOW_REGION;
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = isVercel ? path.join(os.tmpdir(), 'uploads') : path.join(__dirname, 'uploads');
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public')) 
  ? path.join(__dirname, 'public') 
  : path.join(process.cwd(), 'public');

// Đảm bảo thư mục uploads tồn tại
try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch (e) {}

// Cấu hình Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

// Trả về trang admin khi truy cập /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

// Trả về trang nộp bài khi truy cập / hoặc /client
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Endpoint Heartbeat qua HTTP REST (Dự phòng khi môi trường không hỗ trợ WebSocket như Vercel)
app.post('/api/heartbeat', (req, res) => {
  const { deviceName, userId, studentName } = req.body;
  if (!deviceName) return res.json({ success: false });

  const clientIp = getClientIp(req);
  const db = getDB();
  const comp = db.computers.find(c => c.deviceName.toLowerCase() === deviceName.toLowerCase());
  if (comp) {
    comp.status = comp.status === 'submitted' ? 'submitted' : 'online';
    comp.lastHeartbeat = new Date().toISOString();
    comp.currentIp = clientIp;
    if (userId) comp.currentUserId = userId;
    if (studentName) comp.currentStudentName = studentName;

    saveDB(db);
    broadcastWs('computer_updated', comp);
  }
  res.json({ success: true, comp });
});

// Cấu hình Multer để lưu trữ file nộp bài (Chuẩn theo tài liệu Word)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const rawUserId = (req.body.userId || 'UNKNOWN').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const rawDevice = (req.body.deviceName || 'PC-XXX').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
    // Lưu tên file theo cấu trúc: [MãSV]_[TênMáy]_[ThờiGian]_[TênFileGốc]
    // Sử dụng Buffer UTF-8 để giữ nguyên tiếng Việt của file bài làm
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const safeOriginalName = originalName.replace(/[^\w\d\.\-\_]/g, '_');
    cb(null, `${rawUserId}_${rawDevice}_${uniqueSuffix}_${safeOriginalName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 150 * 1024 * 1024 } // Giới hạn 150MB
});

// Helper lấy địa chỉ IP của Client
function getClientIp(req) {
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  if (typeof ip === 'string' && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  // Chuẩn hóa IPv6 localhost hoặc định dạng IPv4-mapped IPv6
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return '127.0.0.1';
  return ip.replace(/^::ffff:/, '');
}

// Helper lấy danh sách IP mạng nội bộ của máy chủ
function getServerIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ interface: name, address: net.address });
      }
    }
  }
  return ips;
}

// Broadcast thông điệp qua WebSocket tới tất cả client đang kết nối (Giám thị & Thí sinh)
function broadcastWs(event, payload) {
  const message = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// ==================== WEBSOCKET HEARTBEAT & REALTIME ====================
wss.on('connection', (ws, req) => {
  const clientIp = getClientIp(req);

  ws.on('message', messageRaw => {
    try {
      const msg = JSON.parse(messageRaw);
      if (msg.type === 'heartbeat') {
        const { deviceName, userId, studentName } = msg;
        if (!deviceName) return;

        const db = getDB();
        const comp = db.computers.find(c => c.deviceName.toLowerCase() === deviceName.toLowerCase());
        if (comp) {
          comp.status = comp.status === 'submitted' ? 'submitted' : 'online';
          comp.lastHeartbeat = new Date().toISOString();
          comp.currentIp = clientIp;
          if (userId) comp.currentUserId = userId;
          if (studentName) comp.currentStudentName = studentName;

          saveDB(db);
          broadcastWs('computer_updated', comp);
        }
      }
    } catch (err) {
      console.error('Lỗi phân tích WebSocket message:', err);
    }
  });
});

// Quét định kỳ kiểm tra các máy bị ngắt kết nối (Offline sau 45s không có heartbeat)
setInterval(() => {
  const db = getDB();
  const now = Date.now();
  let hasChange = false;

  db.computers.forEach(comp => {
    if (comp.status === 'online' && comp.lastHeartbeat) {
      const diff = now - new Date(comp.lastHeartbeat).getTime();
      if (diff > 45000) { // 45 giây
        comp.status = 'offline';
        hasChange = true;
      }
    }
  });

  if (hasChange) {
    saveDB(db);
    broadcastWs('bulk_computers_updated', db.computers);
  }
}, 15000);

// ==================== REST API ENDPOINTS ====================

// 1. Lấy thông tin IP của Client
app.get('/api/my-ip', (req, res) => {
  res.json({ ipAddress: getClientIp(req) });
});

// 2. Lấy thông tin cấu hình kỳ thi & IPs máy chủ
app.get('/api/exam-info', (req, res) => {
  const db = getDB();
  const serverIps = getServerIps();
  res.json({
    exam: db.exam,
    serverIps: serverIps,
    totalComputers: db.computers.length,
    submittedCount: db.submissions.length,
    alertsCount: db.alerts.length
  });
});

// 3. Cập nhật cấu hình kỳ thi (Dành cho Giám thị)
app.post('/api/exam-config', (req, res) => {
  const db = getDB();
  const { title, subject, durationMinutes, isOpen, allowedIpPrefix, allowResubmit } = req.body;

  if (title !== undefined) db.exam.title = title;
  if (subject !== undefined) db.exam.subject = subject;
  if (durationMinutes !== undefined) db.exam.durationMinutes = Number(durationMinutes);
  if (isOpen !== undefined) db.exam.isOpen = Boolean(isOpen);
  if (allowedIpPrefix !== undefined) db.exam.allowedIpPrefix = allowedIpPrefix;
  if (allowResubmit !== undefined) db.exam.allowResubmit = Boolean(allowResubmit);

  saveDB(db);
  broadcastWs('exam_updated', db.exam);
  res.json({ success: true, exam: db.exam });
});

// 4. Lấy danh sách 200 máy tính
app.get('/api/computers', (req, res) => {
  const db = getDB();
  res.json({ computers: db.computers });
});

// 5. Lấy danh sách bài nộp
app.get('/api/submissions', (req, res) => {
  const db = getDB();
  res.json({ submissions: db.submissions });
});

// 6. Lấy danh sách cảnh báo gian lận
app.get('/api/alerts', (req, res) => {
  const db = getDB();
  res.json({ alerts: db.alerts });
});

// 7. API NỘP BÀI THI (Trọng tâm đáp ứng yêu cầu file Word & Chống gian lận)
app.post('/api/submit-exam', upload.single('examFile'), (req, res) => {
  const db = getDB();

  // Kiểm tra nếu phòng thi đã bị khóa
  if (db.exam && db.exam.isOpen === false) {
    return res.status(403).json({
      success: false,
      message: 'Phòng thi đã khóa cổng nộp bài hoặc đã hết giờ làm bài!'
    });
  }

  const userId = (req.body.userId || '').trim();
  const deviceName = (req.body.deviceName || '').trim();
  const studentName = (req.body.studentName || '').trim();
  const notes = (req.body.notes || '').trim();
  const ipAddress = getClientIp(req);

  // Validate các trường bắt buộc theo tài liệu
  if (!req.file || !userId || !deviceName) {
    return res.status(400).json({
      success: false,
      message: 'Dữ liệu không hợp lệ! Vui lòng điền đủ Mã Sinh Viên, Tên Máy và chọn File bài thi.'
    });
  }

  // Khôi phục tên file gốc UTF-8
  const originalFileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

  // Kiểm tra chống gian lận (Anti-Cheat)
  const antiCheatWarnings = checkAntiCheat({ userId, deviceName, ipAddress }, db);

  const submissionRecord = {
    id: `SUB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    userId,
    studentName: studentName || 'Chưa cập nhật',
    deviceName,
    ipAddress,
    fileName: req.file.filename,
    originalName: originalFileName,
    fileSize: req.file.size,
    fileSizeFormatted: (req.file.size / (1024 * 1024)).toFixed(2) + ' MB',
    submitTime: new Date().toISOString(),
    notes: notes,
    hasWarning: antiCheatWarnings.length > 0,
    warnings: antiCheatWarnings
  };

  // Thêm vào danh sách submissions
  db.submissions.unshift(submissionRecord);

  // Cập nhật trạng thái máy tính trong 200 máy
  const matchedComputer = db.computers.find(c => c.deviceName.toLowerCase() === deviceName.toLowerCase());
  if (matchedComputer) {
    matchedComputer.status = 'submitted';
    matchedComputer.currentUserId = userId;
    if (studentName) matchedComputer.currentStudentName = studentName;
    matchedComputer.currentIp = ipAddress;
    matchedComputer.submissionsCount = (matchedComputer.submissionsCount || 0) + 1;
    matchedComputer.lastSubmitTime = submissionRecord.submitTime;
    if (antiCheatWarnings.length > 0) {
      matchedComputer.hasWarning = true;
      matchedComputer.warnings = [...(matchedComputer.warnings || []), ...antiCheatWarnings];
    }
  }

  // Lưu các cảnh báo mới vào db.alerts
  if (antiCheatWarnings.length > 0) {
    antiCheatWarnings.forEach(w => {
      db.alerts.unshift({
        id: `ALT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        submissionId: submissionRecord.id,
        userId,
        deviceName,
        ipAddress,
        time: submissionRecord.submitTime,
        ...w
      });
    });
  }

  saveDB(db);

  // Log theo đúng format của tài liệu Word
  console.log('=== BÀI NỘP MỚI ===', {
    userId,
    studentName,
    deviceName,
    ipAddress,
    fileName: req.file.filename,
    hasWarning: antiCheatWarnings.length > 0
  });

  // Phát tín hiệu realtime đến Dashboard Giám thị
  broadcastWs('submission_created', submissionRecord);
  if (matchedComputer) {
    broadcastWs('computer_updated', matchedComputer);
  }
  if (antiCheatWarnings.length > 0) {
    broadcastWs('alert_created', {
      userId,
      deviceName,
      ipAddress,
      warnings: antiCheatWarnings,
      submissionId: submissionRecord.id
    });
  }

  res.json({
    success: true,
    message: 'Nộp bài thi thành công!',
    data: submissionRecord
  });
});

// 8. Tải một bài nộp cụ thể
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy file bài thi!' });
  }

  // Tìm tên hiển thị ban đầu nếu có
  const db = getDB();
  const sub = db.submissions.find(s => s.fileName === filename);
  const downloadName = sub ? sub.originalName : filename;

  res.download(filePath, downloadName);
});

// 9. Tải toàn bộ bài thi đóng gói trong 1 file ZIP (Cho Giám thị)
app.get('/api/export-zip', (req, res) => {
  const db = getDB();
  const zipFileName = `PhongThi_200May_${db.exam.examCode || 'EXAM'}_${Date.now()}.zip`;

  res.attachment(zipFileName);
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', err => {
    console.error('Lỗi nén zip:', err);
    res.status(500).send({ error: err.message });
  });

  archive.pipe(res);

  // Đính kèm các file bài làm trong thư mục uploads
  if (fs.existsSync(UPLOADS_DIR)) {
    archive.directory(UPLOADS_DIR, 'BaiThi');
  }

  // Đính kèm file báo cáo tổng hợp danh sách bài nộp và cảnh báo (CSV/JSON)
  const reportData = JSON.stringify({
    exam: db.exam,
    totalComputers: 200,
    submissionsTotal: db.submissions.length,
    alertsTotal: db.alerts.length,
    submissions: db.submissions,
    alerts: db.alerts
  }, null, 2);

  archive.append(reportData, { name: 'BaoCao_TongKet_PhongThi.json' });

  archive.finalize();
});

// 10. Tạo dữ liệu giả lập cho phòng 200 máy (Rất tiện lợi để Giám thị test hệ thống)
app.post('/api/simulate-data', (req, res) => {
  const db = getDB();
  const count = parseInt(req.body.count) || 35; // Giả lập nộp 35 máy

  const vietNameseNames = [
    'Nguyễn Văn An', 'Trần Thị Bích', 'Lê Hoàng Cường', 'Phạm Minh Đức',
    'Hoàng Thu Giang', 'Đặng Quốc Huy', 'Bùi Mai Hương', 'Vũ Tuấn Kiệt',
    'Đỗ Phương Linh', 'Ngô Quang Minh', 'Dương Hải Nam', 'Lý Kim Ngân',
    'Phan Thái Phong', 'Trịnh Thanh Quân', 'Hồ Diệu Quỳnh', 'Đinh Trọng Sang'
  ];

  for (let i = 1; i <= count; i++) {
    const pcIndex = i;
    const comp = db.computers[pcIndex - 1];
    if (!comp) continue;

    const idStr = String(pcIndex).padStart(3, '0');
    const userId = `SV2026${idStr}`;
    const studentName = vietNameseNames[i % vietNameseNames.length];
    const ipAddress = `192.168.1.${50 + pcIndex}`;
    const fakeFileName = `${userId}_${comp.deviceName}_demo_BaiLam_${pcIndex}.docx`;

    // Tạo file mẫu trong uploads nếu chưa có
    const dummyPath = path.join(UPLOADS_DIR, fakeFileName);
    if (!fs.existsSync(dummyPath)) {
      fs.writeFileSync(dummyPath, `Bài làm mẫu của sinh viên: ${studentName} - MSSV: ${userId} tại máy ${comp.deviceName}`, 'utf8');
    }

    const sub = {
      id: `SUB-SIM-${Date.now()}-${i}`,
      userId,
      studentName,
      deviceName: comp.deviceName,
      ipAddress,
      fileName: fakeFileName,
      originalName: `BaiTapThucHanh_${userId}.docx`,
      fileSize: 45200 + i * 320,
      fileSizeFormatted: ((45200 + i * 320) / (1024 * 1024)).toFixed(2) + ' MB',
      submitTime: new Date(Date.now() - (count - i) * 60000).toISOString(),
      notes: 'Nộp bài hoàn chỉnh',
      hasWarning: false,
      warnings: []
    };

    comp.status = 'submitted';
    comp.currentUserId = userId;
    comp.currentStudentName = studentName;
    comp.currentIp = ipAddress;
    comp.submissionsCount = 1;
    comp.lastSubmitTime = sub.submitTime;

    db.submissions.unshift(sub);
  }

  // Giả lập 1 trường hợp gian lận: PC-005 nộp hộ cho MSSV khác
  const fraudSub1 = {
    id: `SUB-FRAUD-${Date.now()}-1`,
    userId: 'SV2026999',
    studentName: 'Trần Gian Lận',
    deviceName: 'PC-005', // Máy PC-005 đã nộp trước đó cho SV2026005
    ipAddress: '192.168.1.55',
    fileName: 'SV2026999_PC-005_cheat.docx',
    originalName: 'BaiThi_NopHo.docx',
    fileSize: 32000,
    fileSizeFormatted: '0.03 MB',
    submitTime: new Date().toISOString(),
    notes: 'Nộp bài',
    hasWarning: true,
    warnings: [{
      type: 'DEVICE_MULTIPLE_USERS',
      severity: 'danger',
      title: 'Phát hiện nộp bài hộ (Trùng thiết bị)',
      description: 'Máy tính "PC-005" trước đó đã nộp bài cho SV2026005. Hiện đang nộp cho SV2026999!'
    }]
  };
  db.submissions.unshift(fraudSub1);
  db.alerts.unshift({
    id: `ALT-SIM-1`,
    submissionId: fraudSub1.id,
    userId: 'SV2026999',
    deviceName: 'PC-005',
    ipAddress: '192.168.1.55',
    time: fraudSub1.submitTime,
    ...fraudSub1.warnings[0]
  });
  db.computers[4].hasWarning = true;
  db.computers[4].warnings = fraudSub1.warnings;

  // Giả lập 1 trường hợp nộp bài từ IP lạ bên ngoài phòng thi
  const fraudSub2 = {
    id: `SUB-FRAUD-${Date.now()}-2`,
    userId: 'SV2026088',
    studentName: 'Lê Ngoại Tuyến',
    deviceName: 'PC-088',
    ipAddress: '14.232.188.42', // IP internet công cộng lạ
    fileName: 'SV2026088_PC-088_external.docx',
    originalName: 'BaiThi_NgoaiMang.docx',
    fileSize: 41000,
    fileSizeFormatted: '0.04 MB',
    submitTime: new Date().toISOString(),
    notes: 'Nộp bài từ xa',
    hasWarning: true,
    warnings: [{
      type: 'OUT_OF_NETWORK',
      severity: 'danger',
      title: 'Nộp bài từ xa / IP lạ ngoài phòng thi',
      description: 'Địa chỉ IP (14.232.188.42) không thuộc mạng phòng thi (192.168.1.*). Nghi vấn thí sinh nộp từ ngoài trường!'
    }]
  };
  db.submissions.unshift(fraudSub2);
  db.alerts.unshift({
    id: `ALT-SIM-2`,
    submissionId: fraudSub2.id,
    userId: 'SV2026088',
    deviceName: 'PC-088',
    ipAddress: '14.232.188.42',
    time: fraudSub2.submitTime,
    ...fraudSub2.warnings[0]
  });
  if (db.computers[87]) {
    db.computers[87].status = 'submitted';
    db.computers[87].hasWarning = true;
    db.computers[87].warnings = fraudSub2.warnings;
  }

  saveDB(db);
  broadcastWs('bulk_computers_updated', db.computers);

  res.json({ success: true, message: `Đã giả lập ${count} bài nộp thành công và 2 trường hợp cảnh báo gian lận mẫu!` });
});

// 11. Đặt lại toàn bộ dữ liệu phòng thi
app.post('/api/reset-data', (req, res) => {
  const { generateInitialComputers } = require('./db');
  const freshData = {
    exam: {
      title: 'Kỳ Thi Đánh Giá Năng Lực Thực Hành Tin Học',
      subject: 'Lập Trình Cơ Sở & Ứng Dụng Mạng',
      examCode: 'EXAM-2026-01',
      durationMinutes: 90,
      startTime: new Date().toISOString(),
      isOpen: true,
      allowedIpPrefix: '192.168.1.',
      allowResubmit: true,
      maxFileSizeMb: 100
    },
    computers: generateInitialComputers(200),
    submissions: [],
    alerts: [],
    logs: []
  };

  saveDB(freshData);
  broadcastWs('bulk_computers_updated', freshData.computers);
  broadcastWs('exam_updated', freshData.exam);
  res.json({ success: true, message: 'Đã thiết lập lại trạng thái 200 máy về ban đầu!' });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[LỖI] Cổng ${PORT} đang được ứng dụng khác sử dụng (EADDRINUSE)!`);
    console.error(`Gợi ý: Hãy tắt cửa sổ dòng lệnh Node.js đang chạy trước đó, hoặc chạy lệnh sau trong PowerShell để giải phóng cổng:\n`);
    console.error(`Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess -Force\n`);
    process.exit(1);
  } else {
    console.error('Lỗi khởi động Server:', err);
  }
});

if (!isVercel) {
  server.listen(PORT, () => {
    const ips = getServerIps();
    console.log('\n=============================================================');
    console.log(' HỆ THỐNG QUẢN LÝ PHÒNG THI 200 MÁY TÍNH - KHỞI ĐỘNG THÀNH CÔNG');
    console.log('=============================================================');
    console.log(` • Server đang lắng nghe tại Cổng: ${PORT}`);
    console.log(` • Giao diện Giám thị (Dashboard): http://localhost:${PORT}/admin`);
    console.log(` • Giao diện Thí sinh (Client)  : http://localhost:${PORT}/`);
    if (ips.length > 0) {
      console.log('-------------------------------------------------------------');
      console.log(' • Địa chỉ IP mạng LAN để 200 máy trạm truy cập:');
      ips.forEach(ip => {
        console.log(`   👉 http://${ip.address}:${PORT}/ (Giao diện thí sinh nộp bài)`);
        console.log(`   👉 http://${ip.address}:${PORT}/admin (Dashboard giám thị theo dõi)`);
      });
    }
    console.log('=============================================================\n');
  });
}

module.exports = app;
