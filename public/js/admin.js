/**
 * Admin Dashboard JavaScript - Quản Lý Giám Thị 200 Máy Tính
 */

let computersData = [];
let submissionsData = [];
let alertsData = [];
let examData = {};
let currentRoomFilter = 'all';
let ws = null;

document.addEventListener('DOMContentLoaded', () => {
  initClock();
  fetchInitialData();
  initWebSocket();
});

// 1. Đồng hồ thời gian thực
function initClock() {
  setInterval(() => {
    const now = new Date();
    document.getElementById('clockDisplay').textContent = now.toLocaleTimeString('vi-VN');
  }, 1000);
}

// 2. Tải toàn bộ dữ liệu ban đầu
async function fetchInitialData() {
  try {
    const [resExam, resComp, resSub, resAlt] = await Promise.all([
      fetch('/api/exam-info'),
      fetch('/api/computers'),
      fetch('/api/submissions'),
      fetch('/api/alerts')
    ]);

    const dataExam = await resExam.json();
    const dataComp = await resComp.json();
    const dataSub = await resSub.json();
    const dataAlt = await resAlt.json();

    examData = dataExam.exam || {};
    computersData = dataComp.computers || [];
    submissionsData = dataSub.submissions || [];
    alertsData = dataAlt.alerts || [];

    // Hiển thị danh sách IP LAN của máy chủ
    if (dataExam.serverIps && dataExam.serverIps.length > 0) {
      document.getElementById('serverIpList').innerHTML = dataExam.serverIps
        .map(item => `<a href="http://${item.address}:3000/" target="_blank" class="hover:underline text-blue-700 font-bold">${item.address}:3000</a>`)
        .join(' &nbsp;|&nbsp; ');
    } else {
      document.getElementById('serverIpList').textContent = 'http://localhost:3000/';
    }

    updateExamUI();
    updateStats();
    renderMatrix();
    renderSubmissionsTable();
    renderAlertsTable();
  } catch (err) {
    console.error('Lỗi tải dữ liệu phòng thi:', err);
  }
}

// 3. Cập nhật UI thông tin kỳ thi
function updateExamUI() {
  document.getElementById('examSubTitle').textContent = `${examData.title || 'Kỳ Thi Tin Học'} • ${examData.subject || ''}`;
  const badge = document.getElementById('examStatusBadge');
  const lockIcon = document.getElementById('lockIcon');
  const lockText = document.getElementById('lockText');

  if (examData.isOpen) {
    badge.className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    badge.textContent = 'ĐANG MỞ CỔNG NỘP';
    lockIcon.className = 'fa-solid fa-lock';
    lockText.textContent = 'Khóa Cổng Nộp';
  } else {
    badge.className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30';
    badge.textContent = 'ĐÃ KHÓA CỔNG';
    lockIcon.className = 'fa-solid fa-lock-open';
    lockText.textContent = 'Mở Cổng Nộp';
  }
}

// 4. Cập nhật các thẻ Thống kê (KPIs)
function updateStats() {
  const total = computersData.length || 200;
  const online = computersData.filter(c => c.status === 'online').length;
  const submitted = computersData.filter(c => c.status === 'submitted').length;
  const pending = total - submitted;
  const alertsCount = alertsData.length;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statOnline').textContent = online;
  document.getElementById('statOnlinePct').textContent = `${Math.round((online / total) * 100)}% tổng số máy`;

  document.getElementById('statSubmitted').textContent = submitted;
  document.getElementById('statSubmittedPct').textContent = `${Math.round((submitted / total) * 100)}% hoàn thành`;

  document.getElementById('statPending').textContent = pending;
  document.getElementById('statAlerts').textContent = alertsCount;

  document.getElementById('tabCountSubmissions').textContent = submissionsData.length;
  document.getElementById('tabCountAlerts').textContent = alertsCount;
}

// 5. Kết nối WebSocket Realtime
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      const { event: evt, data } = payload;

      if (evt === 'computer_updated') {
        const idx = computersData.findIndex(c => c.deviceName.toLowerCase() === data.deviceName.toLowerCase());
        if (idx !== -1) {
          computersData[idx] = data;
        } else {
          computersData.push(data);
        }
        updateStats();
        renderMatrix();
      } else if (evt === 'bulk_computers_updated') {
        computersData = data;
        updateStats();
        renderMatrix();
      } else if (evt === 'submission_created') {
        submissionsData.unshift(data);
        updateStats();
        renderSubmissionsTable();
      } else if (evt === 'alert_created') {
        data.warnings.forEach(w => {
          alertsData.unshift({
            id: 'ALT-' + Date.now(),
            submissionId: data.submissionId,
            userId: data.userId,
            deviceName: data.deviceName,
            ipAddress: data.ipAddress,
            time: new Date().toISOString(),
            ...w
          });
        });
        updateStats();
        renderAlertsTable();
      } else if (evt === 'exam_updated') {
        examData = data;
        updateExamUI();
      }
    } catch (err) {
      console.error('Lỗi nhận dữ liệu socket:', err);
    }
  };

  ws.onclose = () => {
    setTimeout(initWebSocket, 4000);
  };
}

// 6. Hiển thị Sơ Đồ Ma Trận 200 Máy Tính
function renderMatrix() {
  const grid = document.getElementById('computersMatrixGrid');
  const statusFilter = document.getElementById('statusFilter').value;
  const keyword = document.getElementById('matrixSearch').value.toLowerCase().trim();

  let filtered = computersData.filter(comp => {
    // Lọc theo phòng
    if (currentRoomFilter !== 'all' && !comp.room.includes(currentRoomFilter)) {
      return false;
    }
    // Lọc theo trạng thái
    if (statusFilter === 'submitted' && comp.status !== 'submitted') return false;
    if (statusFilter === 'online' && comp.status !== 'online') return false;
    if (statusFilter === 'offline' && comp.status !== 'offline') return false;
    if (statusFilter === 'warning' && !comp.hasWarning) return false;

    // Lọc theo từ khóa tìm kiếm
    if (keyword) {
      const matchDevice = comp.deviceName.toLowerCase().includes(keyword);
      const matchUser = (comp.currentUserId || '').toLowerCase().includes(keyword);
      const matchName = (comp.currentStudentName || '').toLowerCase().includes(keyword);
      const matchIp = (comp.currentIp || '').toLowerCase().includes(keyword);
      if (!matchDevice && !matchUser && !matchName && !matchIp) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="col-span-full py-12 text-center text-xs text-slate-400">Không tìm thấy máy tính phù hợp với bộ lọc</div>';
    return;
  }

  grid.innerHTML = filtered.map(comp => {
    let statusClass = 'border-slate-200 bg-white text-slate-700';
    let dotClass = 'bg-slate-300';
    let statusLabel = 'Chưa kết nối';

    if (comp.status === 'submitted') {
      statusClass = 'border-emerald-300 bg-emerald-50/70 text-emerald-900';
      dotClass = 'bg-emerald-500';
      statusLabel = 'Đã nộp bài';
    } else if (comp.status === 'online') {
      statusClass = 'border-blue-300 bg-blue-50/70 text-blue-900';
      dotClass = 'bg-blue-500';
      statusLabel = 'Đang làm bài';
    }

    // Nếu có cảnh báo gian lận thì viền đỏ nhấp nháy
    const warningPulse = comp.hasWarning ? 'pulse-danger border-rose-500 bg-rose-50/80 text-rose-900' : '';

    return `
      <div onclick="openComputerModal('${comp.deviceName}')"
           class="computer-card cursor-pointer rounded-xl border p-2 flex flex-col justify-between h-20 relative select-none ${statusClass} ${warningPulse}">
        
        <!-- Header máy -->
        <div class="flex items-center justify-between">
          <span class="font-extrabold text-xs font-mono">${comp.deviceName}</span>
          <div class="flex items-center gap-1">
            ${comp.hasWarning ? '<i class="fa-solid fa-triangle-exclamation text-rose-500 text-[11px]" title="Có cảnh báo gian lận"></i>' : ''}
            <span class="w-2.5 h-2.5 rounded-full ${dotClass}"></span>
          </div>
        </div>

        <!-- Thông tin sinh viên nếu có -->
        <div class="truncate text-[10px] mt-1">
          ${comp.currentUserId 
            ? `<p class="font-bold font-mono text-slate-900 truncate">${comp.currentUserId}</p>
               <p class="text-slate-500 truncate text-[9px]">${comp.currentStudentName || ''}</p>`
            : `<p class="text-slate-400 italic">Trống</p>`}
        </div>

        <!-- Footer tóm tắt -->
        <div class="text-[9px] text-slate-400 truncate flex justify-between items-center mt-auto pt-0.5 border-t border-slate-200/50">
          <span>${comp.currentIp || comp.expectedIp.split('.').slice(2).join('.')}</span>
          ${comp.submissionsCount > 0 ? `<span class="font-semibold text-emerald-600"><i class="fa-solid fa-check"></i> ${comp.submissionsCount}</span>` : ''}
        </div>

      </div>
    `;
  }).join('');
}

// 7. Lọc theo phòng
function filterRoom(room) {
  currentRoomFilter = room;
  document.querySelectorAll('.room-btn').forEach(btn => {
    if (btn.getAttribute('data-room') === room) {
      btn.className = 'room-btn active px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white';
    } else {
      btn.className = 'room-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 border border-slate-200 hover:bg-slate-100';
    }
  });
  renderMatrix();
}

// 8. Bảng Danh Sách Bài Nộp
function renderSubmissionsTable() {
  const tbody = document.getElementById('submissionsTableBody');
  const keyword = document.getElementById('subSearch').value.toLowerCase().trim();

  let filtered = submissionsData.filter(s => {
    if (!keyword) return true;
    return s.userId.toLowerCase().includes(keyword) ||
           (s.studentName || '').toLowerCase().includes(keyword) ||
           s.deviceName.toLowerCase().includes(keyword) ||
           s.ipAddress.toLowerCase().includes(keyword) ||
           (s.originalName || '').toLowerCase().includes(keyword);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-xs text-slate-400">Chưa có bài thi nào nộp hoặc không khớp tìm kiếm</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((sub, idx) => {
    const timeStr = new Date(sub.submitTime).toLocaleTimeString('vi-VN') + ' ' + new Date(sub.submitTime).toLocaleDateString('vi-VN');
    const warningBadge = sub.hasWarning 
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-1 justify-center">
           <i class="fa-solid fa-triangle-exclamation"></i> Cảnh báo (${sub.warnings ? sub.warnings.length : 1})
         </span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200">
           Hợp lệ
         </span>`;

    return `
      <tr class="hover:bg-slate-50 transition ${sub.hasWarning ? 'bg-rose-50/30' : ''}">
        <td class="px-3 py-3 font-mono text-slate-400">${idx + 1}</td>
        <td class="px-3 py-3 font-bold font-mono text-slate-900">${sub.userId}</td>
        <td class="px-3 py-3 font-semibold text-slate-800">${sub.studentName || 'Chưa cập nhật'}</td>
        <td class="px-3 py-3 font-mono font-bold text-blue-600">${sub.deviceName}</td>
        <td class="px-3 py-3 font-mono text-slate-600">${sub.ipAddress}</td>
        <td class="px-3 py-3 font-mono text-xs text-slate-700 truncate max-w-[180px]" title="${sub.originalName || sub.fileName}">
          ${sub.originalName || sub.fileName}
        </td>
        <td class="px-3 py-3 text-slate-500">${sub.fileSizeFormatted || '---'}</td>
        <td class="px-3 py-3 text-slate-500">${timeStr}</td>
        <td class="px-3 py-3 text-center">${warningBadge}</td>
        <td class="px-3 py-3 text-right">
          <a href="/api/download/${sub.fileName}" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition font-semibold text-xs">
            <i class="fa-solid fa-download"></i> Tải
          </a>
        </td>
      </tr>
    `;
  }).join('');
}

// 9. Bảng Trung Tâm Cảnh Báo Gian Lận
function renderAlertsTable() {
  const tbody = document.getElementById('alertsTableBody');
  if (alertsData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-xs text-slate-400">Tuyệt vời! Chưa phát hiện vi phạm gian lận nào trong phòng thi.</td></tr>';
    return;
  }

  tbody.innerHTML = alertsData.map(alt => {
    const timeStr = new Date(alt.time || Date.now()).toLocaleTimeString('vi-VN');
    const severityBadge = alt.severity === 'danger'
      ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-600 text-white">NGHIÊM TRỌNG</span>'
      : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white">CẢNH BÁO</span>';

    return `
      <tr class="hover:bg-rose-50/50 transition">
        <td class="px-3 py-3 text-slate-500 font-mono">${timeStr}</td>
        <td class="px-3 py-3 font-bold text-rose-700">${alt.title || alt.type}</td>
        <td class="px-3 py-3 font-bold font-mono text-slate-900">${alt.userId}</td>
        <td class="px-3 py-3 font-mono font-bold text-blue-600">${alt.deviceName}</td>
        <td class="px-3 py-3 font-mono text-slate-600">${alt.ipAddress}</td>
        <td class="px-3 py-3 text-rose-800 text-xs">${alt.description}</td>
        <td class="px-3 py-3 text-center">${severityBadge}</td>
      </tr>
    `;
  }).join('');
}

// 10. Chuyển đổi Tab điều hướng
function switchTab(tab) {
  const tabs = ['matrix', 'submissions', 'alerts'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tabBtn${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const view = document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}View`);
    
    if (t === tab) {
      btn.className = 'px-4 py-2.5 text-xs font-bold rounded-t-xl border-b-2 border-blue-600 text-blue-600 bg-white transition flex items-center gap-2';
      view.classList.remove('hidden');
    } else {
      btn.className = 'px-4 py-2.5 text-xs font-bold rounded-t-xl border-b-2 border-transparent text-slate-500 hover:text-slate-700 transition flex items-center gap-2';
      view.classList.add('hidden');
    }
  });
}

// 11. Modal Chi Tiết Máy Tính
function openComputerModal(deviceName) {
  const comp = computersData.find(c => c.deviceName.toLowerCase() === deviceName.toLowerCase());
  if (!comp) return;

  document.getElementById('modalDeviceName').textContent = comp.deviceName;
  document.getElementById('modalDeviceRoom').textContent = comp.room || 'Phòng thi';
  document.getElementById('modalUserId').textContent = comp.currentUserId || 'Chưa có thông tin';
  document.getElementById('modalStudentName').textContent = comp.currentStudentName || 'Chưa cập nhật';
  document.getElementById('modalIp').textContent = comp.currentIp || 'Chưa nhận diện';
  document.getElementById('modalExpectedIp').textContent = comp.expectedIp;
  document.getElementById('modalSubmitCount').textContent = comp.submissionsCount || 0;
  document.getElementById('modalSubmitTime').textContent = comp.lastSubmitTime 
    ? new Date(comp.lastSubmitTime).toLocaleString('vi-VN') 
    : 'Chưa nộp bài';

  const badge = document.getElementById('modalStatusBadge');
  if (comp.status === 'submitted') {
    badge.className = 'text-xs font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200';
    badge.textContent = '🟢 Đã nộp bài';
  } else if (comp.status === 'online') {
    badge.className = 'text-xs font-bold px-3 py-1 rounded-full bg-blue-100 text-blue-700 border border-blue-200';
    badge.textContent = '🔵 Đang kết nối Online';
  } else {
    badge.className = 'text-xs font-bold px-3 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200';
    badge.textContent = '⚪ Chưa kết nối (Offline)';
  }

  // Cảnh báo
  const warnBox = document.getElementById('modalWarningsBox');
  const warnList = document.getElementById('modalWarningsList');
  if (comp.hasWarning && comp.warnings && comp.warnings.length > 0) {
    warnBox.classList.remove('hidden');
    warnList.innerHTML = comp.warnings.map(w => `<p>• <strong>${w.title}:</strong> ${w.description}</p>`).join('');
  } else {
    warnBox.classList.add('hidden');
  }

  // Tải bài thi của máy này
  const downloadBox = document.getElementById('modalDownloadBox');
  const sub = submissionsData.find(s => s.deviceName.toLowerCase() === comp.deviceName.toLowerCase());
  if (sub) {
    downloadBox.classList.remove('hidden');
    document.getElementById('modalDownloadBtn').href = `/api/download/${sub.fileName}`;
  } else {
    downloadBox.classList.add('hidden');
  }

  document.getElementById('computerDetailModal').classList.remove('hidden');
}

function closeComputerModal() {
  document.getElementById('computerDetailModal').classList.add('hidden');
}

// 12. Bật / Tắt Khóa Phòng Thi
async function toggleExamLock() {
  const newIsOpen = !examData.isOpen;
  try {
    const res = await fetch('/api/exam-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isOpen: newIsOpen })
    });
    const data = await res.json();
    if (data.success) {
      examData = data.exam;
      updateExamUI();
    }
  } catch (err) {
    alert('Lỗi cập nhật trạng thái phòng thi: ' + err.message);
  }
}

// 13. Giả Lập Dữ Liệu Demo 35 Máy
async function simulateDemoData() {
  if (!confirm('Bạn có chắc muốn tự động tạo dữ liệu thi giả lập cho 35 máy và 2 ca cảnh báo gian lận mẫu để kiểm thử?')) return;
  try {
    const res = await fetch('/api/simulate-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 35 })
    });
    const data = await res.json();
    alert(data.message || 'Đã tạo dữ liệu giả lập thành công!');
    fetchInitialData();
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

// 14. Đặt lại dữ liệu phòng thi
async function resetDataConfirm() {
  if (!confirm('CẢNH BÁO: Bạn có chắc chắn muốn xóa toàn bộ bài nộp và đưa 200 máy về trạng thái ban đầu?')) return;
  try {
    const res = await fetch('/api/reset-data', { method: 'POST' });
    const data = await res.json();
    alert(data.message || 'Đã thiết lập lại trạng thái 200 máy thành công!');
    fetchInitialData();
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

// 15. Cấu hình Kỳ Thi
function openConfigModal() {
  document.getElementById('cfgTitle').value = examData.title || '';
  document.getElementById('cfgSubject').value = examData.subject || '';
  document.getElementById('cfgDuration').value = examData.durationMinutes || 90;
  document.getElementById('cfgIpPrefix').value = examData.allowedIpPrefix || '192.168.1.';
  document.getElementById('cfgResubmit').checked = examData.allowResubmit !== false;

  document.getElementById('configModal').classList.remove('hidden');
}

function closeConfigModal() {
  document.getElementById('configModal').classList.add('hidden');
}

async function saveExamConfig() {
  const payload = {
    title: document.getElementById('cfgTitle').value,
    subject: document.getElementById('cfgSubject').value,
    durationMinutes: document.getElementById('cfgDuration').value,
    allowedIpPrefix: document.getElementById('cfgIpPrefix').value,
    allowResubmit: document.getElementById('cfgResubmit').checked
  };

  try {
    const res = await fetch('/api/exam-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      examData = data.exam;
      updateExamUI();
      closeConfigModal();
      alert('Đã cập nhật cấu hình phòng thi thành công!');
    }
  } catch (err) {
    alert('Lỗi lưu cấu hình: ' + err.message);
  }
}
