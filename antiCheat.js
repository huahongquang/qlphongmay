/**
 * Module Chống Gian Lận (Anti-Cheat Engine)
 * Phân tích và phát hiện các hành vi gian lận phòng thi:
 * 1. Phát hiện thi hộ / đổi máy (User ID đăng nhập/nộp bài từ máy hoặc IP khác)
 * 2. Phát hiện nộp bài hộ (Một máy hoặc IP nộp bài cho nhiều User ID khác nhau)
 * 3. Ngăn chặn nộp bài từ xa (IP xuất phát ngoài mạng nội bộ phòng máy)
 */

function checkAntiCheat(submissionData, db) {
  const { userId, deviceName, ipAddress } = submissionData;
  const warnings = [];
  const submissions = db.submissions || [];
  const exam = db.exam || {};

  // 1. Kiểm tra dải IP mạng phòng thi (Ngăn nộp bài từ xa ngoài phòng thi)
  // Xử lý cả trường hợp localhost '::1' hoặc '127.0.0.1' khi chạy test nội bộ
  const isLocalhost = ipAddress === '127.0.0.1' || ipAddress === '::1' || ipAddress.includes('localhost');
  if (exam.allowedIpPrefix && !isLocalhost) {
    // Nếu exam có cấu hình tiền tố IP phòng thi ví dụ 192.168.1.
    const cleanIp = ipAddress.replace(/^::ffff:/, '');
    if (!cleanIp.startsWith(exam.allowedIpPrefix) && !cleanIp.startsWith('10.') && !cleanIp.startsWith('172.16.')) {
      warnings.push({
        type: 'OUT_OF_NETWORK',
        severity: 'danger',
        title: 'Nộp bài từ xa / IP lạ ngoài phòng thi',
        description: `Địa chỉ IP (${cleanIp}) không thuộc dải mạng phòng thi (${exam.allowedIpPrefix}*). Nghi vấn thí sinh nộp bài từ bên ngoài!`
      });
    }
  }

  // 2. Phát hiện nộp bài hộ (Một máy hoặc 1 IP nộp nhiều bài cho các User ID khác nhau)
  const previousSubmissionsSameDevice = submissions.filter(
    s => s.deviceName.toLowerCase() === deviceName.toLowerCase() && s.userId.toLowerCase() !== userId.toLowerCase()
  );
  if (previousSubmissionsSameDevice.length > 0) {
    const otherUsers = [...new Set(previousSubmissionsSameDevice.map(s => s.userId))].join(', ');
    warnings.push({
      type: 'DEVICE_MULTIPLE_USERS',
      severity: 'danger',
      title: 'Phát hiện nộp bài hộ (Trùng thiết bị)',
      description: `Máy tính "${deviceName}" trước đó đã nộp bài cho thí sinh khác (${otherUsers}). Một máy không được nộp cho nhiều thí sinh!`
    });
  }

  // 3. Phát hiện thi hộ / đổi máy (User ID nộp từ máy khác hoặc IP khác so với lần nộp/kết nối trước)
  const previousSubmissionsSameUser = submissions.filter(
    s => s.userId.toLowerCase() === userId.toLowerCase()
  );
  if (previousSubmissionsSameUser.length > 0) {
    const diffDevice = previousSubmissionsSameUser.find(s => s.deviceName.toLowerCase() !== deviceName.toLowerCase());
    if (diffDevice) {
      warnings.push({
        type: 'USER_MULTIPLE_DEVICES',
        severity: 'warning',
        title: 'Phát hiện đổi máy / Nghi vấn thi hộ',
        description: `Thí sinh "${userId}" trước đó đã nộp bài từ máy "${diffDevice.deviceName}" nhưng lần này lại nộp từ máy "${deviceName}"!`
      });
    }

    const diffIp = previousSubmissionsSameUser.find(s => {
      const cleanPrev = s.ipAddress.replace(/^::ffff:/, '');
      const cleanCur = ipAddress.replace(/^::ffff:/, '');
      return cleanPrev !== cleanCur;
    });
    if (diffIp && !isLocalhost) {
      warnings.push({
        type: 'USER_IP_CHANGED',
        severity: 'warning',
        title: 'Thay đổi địa chỉ IP máy trạm',
        description: `Thí sinh "${userId}" nộp bài từ IP mới (${ipAddress}) khác với IP nộp trước đó (${diffIp.ipAddress})!`
      });
    }
  }

  // 4. Kiểm tra đối chiếu với thông tin máy tính trong cơ sở dữ liệu 200 máy
  const matchedComputer = db.computers.find(c => c.deviceName.toLowerCase() === deviceName.toLowerCase());
  if (matchedComputer) {
    if (matchedComputer.currentUserId && matchedComputer.currentUserId.toLowerCase() !== userId.toLowerCase()) {
      warnings.push({
        type: 'DEVICE_USER_MISMATCH',
        severity: 'danger',
        title: 'Máy tính đang được gán cho thí sinh khác',
        description: `Máy "${deviceName}" đang kết nối bởi thí sinh "${matchedComputer.currentUserId}" nhưng bài nộp lại ghi nhận mã "${userId}"!`
      });
    }
  }

  return warnings;
}

module.exports = {
  checkAntiCheat
};
