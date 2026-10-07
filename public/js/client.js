/**
 * Client-Side JavaScript cho Máy Trạm Thí Sinh
 */

let ws = null;
let currentClientIp = '127.0.0.1';
let heartbeatInterval = null;

// Khởi chạy khi tài liệu sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  initQuickSelectDevices();
  fetchClientIp();
  fetchExamInfo();
  initWebSocket();
  restoreSavedDevice();
});

// 1. Tạo danh sách 200 máy trạm để chọn nhanh
function initQuickSelectDevices() {
  const select = document.getElementById('quickSelectDevice');
  if (!select) return;

  for (let i = 1; i <= 200; i++) {
    const idStr = String(i).padStart(3, '0');
    const opt = document.createElement('option');
    opt.value = `PC-${idStr}`;
    opt.textContent = `PC-${idStr}`;
    select.appendChild(opt);
  }
}

// 2. Điền nhanh tên máy
function applyQuickDevice(val) {
  if (val) {
    document.getElementById('deviceName').value = val;
    localStorage.setItem('qlpm_saved_device', val);
    sendHeartbeat();
  }
}

// 3. Khôi phục máy đã lưu từ lần trước
function restoreSavedDevice() {
  const savedDevice = localStorage.getItem('qlpm_saved_device');
  if (savedDevice) {
    document.getElementById('deviceName').value = savedDevice;
    const select = document.getElementById('quickSelectDevice');
    if (select) select.value = savedDevice;
  }
  const savedUserId = localStorage.getItem('qlpm_saved_userId');
  if (savedUserId) {
    document.getElementById('userId').value = savedUserId;
  }
  const savedName = localStorage.getItem('qlpm_saved_name');
  if (savedName) {
    document.getElementById('studentName').value = savedName;
  }
}

// 4. Lấy IP máy trạm từ server
async function fetchClientIp() {
  try {
    const res = await fetch('/api/my-ip');
    const data = await res.json();
    currentClientIp = data.ipAddress || '127.0.0.1';
    document.getElementById('clientIpDisplay').textContent = currentClientIp;
    document.getElementById('ipAddressField').value = currentClientIp;
  } catch (err) {
    console.warn('Không lấy được IP qua API:', err);
    document.getElementById('clientIpDisplay').textContent = '127.0.0.1 (LAN)';
    document.getElementById('ipAddressField').value = '127.0.0.1';
  }
}

// 5. Lấy cấu hình kỳ thi
async function fetchExamInfo() {
  try {
    const res = await fetch('/api/exam-info');
    const data = await res.json();
    if (data.exam) {
      document.getElementById('examTitle').textContent = data.exam.title || 'Kỳ Thi Tin Học';
      document.getElementById('examSubject').textContent = `Môn thi: ${data.exam.subject || 'Thực hành Tin học'}`;
      document.getElementById('headerSubject').textContent = data.exam.subject || 'Quản lý phòng thi';

      // Kiểm tra trạng thái khóa cổng nộp
      const lockedAlert = document.getElementById('examLockedAlert');
      const submitBtn = document.getElementById('submitBtn');
      if (!data.exam.isOpen) {
        lockedAlert.classList.remove('hidden');
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
        document.getElementById('submitBtnText').textContent = 'CỔNG NỘP BÀI ĐANG KHÓA';
      } else {
        lockedAlert.classList.add('hidden');
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        document.getElementById('submitBtnText').textContent = 'XÁC NHẬN NỘP BÀI THI';
      }
    }
  } catch (err) {
    console.error('Lỗi khi tải thông tin kỳ thi:', err);
  }
}

// 6. Kết nối WebSocket để duy trì Trạng Thái Online thời gian thực
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      updateConnectionBadge(true);
      sendHeartbeat();
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(sendHeartbeat, 15000); // 15 giây ping 1 lần
    };

    ws.onclose = () => {
      updateConnectionBadge(false);
      // Thử kết nối lại sau 4s
      setTimeout(initWebSocket, 4000);
    };

    ws.onerror = () => {
      updateConnectionBadge(false);
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === 'exam_updated') {
          fetchExamInfo();
        }
      } catch (e) {
        // Ignored
      }
    };
  } catch (e) {
    console.error('Không thể kết nối WebSocket:', e);
  }
}

function updateConnectionBadge(isConnected) {
  const badge = document.getElementById('connectionBadge');
  if (isConnected) {
    badge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200';
    badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500 pulse-dot"></span><span>Đã kết nối Server</span>';
  } else {
    badge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200';
    badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500"></span><span>Mất kết nối Server...</span>';
  }
}

// Gửi Heartbeat lên server để Giám thị biết máy này đang online
async function sendHeartbeat() {
  const deviceName = document.getElementById('deviceName').value.trim();
  const userId = document.getElementById('userId').value.trim();
  const studentName = document.getElementById('studentName').value.trim();

  if (!deviceName) return;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'heartbeat',
      deviceName,
      userId,
      studentName
    }));
    updateConnectionBadge(true);
  } else {
    // Dự phòng qua HTTP REST khi chạy trên môi trường như Vercel
    try {
      const res = await fetch('/api/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceName, userId, studentName })
      });
      const data = await res.json();
      if (data.success) {
        updateConnectionBadge(true);
      }
    } catch (e) {
      updateConnectionBadge(false);
    }
  }
}

// 7. Xử lý Drag & Drop và File Selection
let currentFile = null;

function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('dropZone').classList.add('drag-active');
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('dropZone').classList.remove('drag-active');
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('dropZone').classList.remove('drag-active');
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleFileSelected(e.dataTransfer.files);
  }
}

function handleFileSelected(files) {
  if (!files || files.length === 0) return;
  currentFile = files[0];

  document.getElementById('fileNameDisplay').textContent = currentFile.name;
  const sizeMb = (currentFile.size / (1024 * 1024)).toFixed(2);
  document.getElementById('fileSizeDisplay').textContent = `${sizeMb} MB (${currentFile.size.toLocaleString()} bytes)`;

  document.getElementById('dropPrompt').classList.add('hidden');
  document.getElementById('filePreview').classList.remove('hidden');
}

function clearSelectedFile(e) {
  if (e) e.stopPropagation();
  currentFile = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('dropPrompt').classList.remove('hidden');
  document.getElementById('filePreview').classList.add('hidden');
}

// 8. Xử lý Nộp Bài
async function handleFormSubmit(e) {
  e.preventDefault();

  const userId = document.getElementById('userId').value.trim();
  const studentName = document.getElementById('studentName').value.trim();
  const deviceName = document.getElementById('deviceName').value.trim();
  const notes = document.getElementById('notes').value.trim();

  if (!userId || !studentName || !deviceName) {
    alert('Vui lòng điền đầy đủ Mã sinh viên, Họ tên và Tên máy!');
    return;
  }

  if (!currentFile) {
    alert('Vui lòng chọn hoặc kéo thả file bài làm trước khi nộp!');
    return;
  }

  // Lưu thông tin vào localStorage để nhớ lần sau
  localStorage.setItem('qlpm_saved_device', deviceName);
  localStorage.setItem('qlpm_saved_userId', userId);
  localStorage.setItem('qlpm_saved_name', studentName);

  // Đóng gói FormData
  const formData = new FormData();
  formData.append('examFile', currentFile);
  formData.append('userId', userId);
  formData.append('studentName', studentName);
  formData.append('deviceName', deviceName);
  formData.append('notes', notes);

  const submitBtn = document.getElementById('submitBtn');
  const btnText = document.getElementById('submitBtnText');
  submitBtn.disabled = true;
  btnText.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Đang tải bài lên máy chủ...';

  try {
    const res = await fetch('/api/submit-exam', {
      method: 'POST',
      body: formData
    });

    const result = await res.json();

    if (result.success && result.data) {
      showReceipt(result.data);
    } else {
      alert('Lỗi nộp bài: ' + (result.message || 'Không rõ nguyên nhân'));
    }
  } catch (err) {
    console.error('Lỗi khi gửi yêu cầu nộp bài:', err);
    alert('Lỗi kết nối tới máy chủ! Vui lòng kiểm tra lại mạng nội bộ.');
  } finally {
    submitBtn.disabled = false;
    btnText.innerHTML = 'XÁC NHẬN NỘP BÀI THI';
  }
}

// 9. Hiển thị Biên Nhận Điện Tử
function showReceipt(record) {
  document.getElementById('rcUserId').textContent = record.userId;
  document.getElementById('rcStudentName').textContent = record.studentName || 'Chưa cập nhật';
  document.getElementById('rcDeviceName').textContent = record.deviceName;
  document.getElementById('rcIp').textContent = record.ipAddress;
  document.getElementById('rcFileName').textContent = record.fileName;
  document.getElementById('rcTime').textContent = new Date(record.submitTime).toLocaleString('vi-VN');

  document.getElementById('submitCard').classList.add('hidden');
  document.getElementById('receiptCard').classList.remove('hidden');

  // Cuộn mượt tới biên nhận
  document.getElementById('receiptCard').scrollIntoView({ behavior: 'smooth' });
}

// 10. Quay lại nộp bài mới / nộp lại
function resetForNewSubmission() {
  clearSelectedFile(null);
  document.getElementById('receiptCard').classList.add('hidden');
  document.getElementById('submitCard').classList.remove('hidden');
  document.getElementById('submitCard').scrollIntoView({ behavior: 'smooth' });
}
