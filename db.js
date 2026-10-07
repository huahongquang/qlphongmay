const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

// Đảm bảo thư mục data tồn tại
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Khởi tạo 200 máy tính mặc định
function generateInitialComputers(count = 200) {
  const computers = [];
  for (let i = 1; i <= count; i++) {
    const idStr = String(i).padStart(3, '0');
    const deviceName = `PC-${idStr}`;
    
    // Phân bổ 4 phòng máy: Phòng A (1-50), B (51-100), C (101-150), D (151-200)
    let room = 'Phòng A (Tầng 1)';
    if (i > 50 && i <= 100) room = 'Phòng B (Tầng 1)';
    else if (i > 100 && i <= 150) room = 'Phòng C (Tầng 2)';
    else if (i > 150) room = 'Phòng D (Tầng 2)';

    computers.push({
      id: i,
      deviceName: deviceName,
      room: room,
      expectedIp: `192.168.1.${50 + i}`,
      status: 'offline', // 'offline' | 'online' | 'submitted' | 'warning'
      lastHeartbeat: null,
      currentUserId: null,
      currentStudentName: null,
      currentIp: null,
      submissionsCount: 0,
      hasWarning: false,
      warnings: []
    });
  }
  return computers;
}

// Dữ liệu ban đầu
const initialData = {
  exam: {
    title: 'Kỳ Thi Đánh Giá Năng Lực Thực Hành Tin Học',
    subject: 'Lập Trình Cơ Sở & Ứng Dụng Mạng',
    examCode: 'EXAM-2026-01',
    durationMinutes: 90,
    startTime: new Date().toISOString(),
    isOpen: true, // Cho phép nộp bài hay đang khóa
    allowedIpPrefix: '192.168.1.', // Dải IP mạng nội bộ phòng máy
    allowResubmit: true, // Cho phép nộp lại bài
    maxFileSizeMb: 100
  },
  computers: generateInitialComputers(200),
  submissions: [],
  alerts: [],
  logs: []
};

// Đọc DB
function getDB() {
  if (!fs.existsSync(DB_FILE)) {
    saveDB(initialData);
    return initialData;
  }
  try {
    const content = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Lỗi khi đọc file DB:', err);
    return initialData;
  }
}

// Lưu DB an toàn
function saveDB(data) {
  try {
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('Lỗi khi lưu file DB:', err);
  }
}

module.exports = {
  getDB,
  saveDB,
  generateInitialComputers
};
