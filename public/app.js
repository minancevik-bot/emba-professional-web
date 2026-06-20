(function () {
  const state = {
    user: null,
    settings: {},
    students: [],
    payments: [],
    attendance: [],
    studentDetails: {},
    openStudentId: null,
    activeView: "dashboardView",
    searchTimer: null
  };

  const statusLabels = {
    present: "Geldi",
    absent: "Gelmedi",
    excused: "Mazeretli",
    planned: "Planlandı"
  };

  const viewMeta = {
    dashboardView: ["Yönetim Paneli", "Kulüp operasyonlarını tek ekrandan takip edin."],
    studentsView: ["Öğrenciler", "Kayıt, ders ve veli bilgilerini düzenleyin."],
    attendanceView: ["Yoklama", "Günlük ders katılımını hızlıca yönetin."],
    paymentsView: ["Ödemeler", "Tahsilat, kalan bakiye ve WhatsApp takibini yapın."],
    usersView: ["Kullanıcılar", "Rol ve durum bilgilerini kulüp bazında izleyin."],
    backupView: ["Raporlar", "Yedekler ve işlem kayıtlarını kontrol edin."]
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const els = {
    loginView: $("#loginView"),
    appShell: $("#appShell"),
    loginForm: $("#loginForm"),
    loginUsername: $("#loginUsername"),
    loginPassword: $("#loginPassword"),
    rememberMe: $("#rememberMe"),
    loginMessage: $("#loginMessage"),
    sidebar: $("#sidebar"),
    sidebarOverlay: $("#sidebarOverlay"),
    mobileMenuButton: $("#mobileMenuButton"),
    pageTitle: $("#pageTitle"),
    pageSubtitle: $("#pageSubtitle"),
    notice: $("#notice"),
    userBadge: $("#userBadge"),
    logoutButton: $("#logoutButton"),
    globalSearch: $("#globalSearch"),
    dashboardCards: $("#dashboardCards"),
    revenueChart: $("#revenueChart"),
    attendanceSummary: $("#attendanceSummary"),
    todayLessons: $("#todayLessons"),
    recentStudents: $("#recentStudents"),
    paymentWaiting: $("#paymentWaiting"),
    refreshDashboardButton: $("#refreshDashboardButton"),
    studentStatusFilter: $("#studentStatusFilter"),
    studentCount: $("#studentCount"),
    newStudentButton: $("#newStudentButton"),
    studentEditor: $("#studentEditor"),
    studentForm: $("#studentForm"),
    studentTable: $("#studentTable"),
    studentDetail: $("#studentDetail"),
    cancelStudentButton: $("#cancelStudentButton"),
    attendanceDate: $("#attendanceDate"),
    attendanceForm: $("#attendanceForm"),
    attendanceStudent: $("#attendanceStudent"),
    attendanceCards: $("#attendanceCards"),
    attendanceTable: $("#attendanceTable"),
    paymentMonthFilter: $("#paymentMonthFilter"),
    paymentSearch: $("#paymentSearch"),
    paymentStatusFilter: $("#paymentStatusFilter"),
    paymentStats: $("#paymentStats"),
    paymentForm: $("#paymentForm"),
    paymentStudent: $("#paymentStudent"),
    paymentMonthlyFee: $("#paymentMonthlyFee"),
    paymentPaidAmount: $("#paymentPaidAmount"),
    paymentDate: $("#paymentDate"),
    paymentTable: $("#paymentTable"),
    userForm: $("#userForm"),
    userTable: $("#userTable"),
    runBackupButton: $("#runBackupButton"),
    backupTable: $("#backupTable"),
    auditLogList: $("#auditLogList")
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function money(value) {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  function dateLabel(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("tr-TR").format(new Date(value));
  }

  function monthValue() {
    return new Date().toISOString().slice(0, 7);
  }

  function monthLabel(value) {
    if (!value) return "";
    const month = String(value).slice(0, 7);
    const [year, monthNumber] = month.split("-");
    const date = new Date(Number(year), Number(monthNumber) - 1, 1);
    return new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(date);
  }

  function todayName() {
    return new Intl.DateTimeFormat("tr-TR", { weekday: "long" }).format(new Date());
  }

  function recordNo(student) {
    return `EMB-${String(student.id || 0).padStart(4, "0")}`;
  }

  function normalizedRole() {
    return state.user?.normalizedRole || state.user?.role || "";
  }

  function can(permission) {
    return state.user?.permissions?.includes(permission);
  }

  function lessonText(student) {
    return (student.lessons || []).map((item) => `${item.day || ""} ${item.time || ""}`.trim()).filter(Boolean).join(" / ");
  }

  function statusBadge(status) {
    const label = statusLabels[status] || status || "-";
    const className = status === "Aktif" || status === "present"
      ? "good"
      : status === "Bekleyen" || status === "excused" || status === "planned"
        ? "warn"
        : "bad";
    return `<span class="badge ${className}">${escapeHtml(label)}</span>`;
  }

  function roleBadge(role, label) {
    return `<span class="role-badge role-${escapeHtml(String(role || "viewer").replace("_", "-"))}">${escapeHtml(label || role || "viewer")}</span>`;
  }

  function emptyState(title, text) {
    return `
      <div class="empty-state">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(text || "")}</span>
      </div>
    `;
  }

  function emptyRow(cols, title, text) {
    return `<tr class="empty-row"><td colspan="${cols}">${emptyState(title, text)}</td></tr>`;
  }

  function setNotice(message, isError) {
    els.notice.textContent = message || "";
    els.notice.classList.toggle("error", Boolean(isError));
    if (message && !isError) {
      window.setTimeout(() => {
        if (els.notice.textContent === message) els.notice.textContent = "";
      }, 3500);
    }
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });

    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      showLogin();
      throw new Error(data.error || "Oturum gerekli.");
    }
    if (!response.ok) {
      throw new Error(data.error || "İşlem tamamlanamadı.");
    }
    return data;
  }

  function closeMobileMenu() {
    document.body.classList.remove("sidebar-open");
    if (els.sidebarOverlay) els.sidebarOverlay.hidden = true;
  }

  function openMobileMenu() {
    document.body.classList.add("sidebar-open");
    if (els.sidebarOverlay) els.sidebarOverlay.hidden = false;
  }

  function showLogin() {
    state.user = null;
    closeMobileMenu();
    els.loginView.classList.remove("hidden");
    els.appShell.classList.add("hidden");
  }

  function updateRoleMenuLabels() {
    const role = normalizedRole();
    const dashboardButton = $('[data-view="dashboardView"] span');
    const studentsButton = $('[data-view="studentsView"] span');
    if (role === "coach") {
      if (dashboardButton) dashboardButton.textContent = "Bugünkü Derslerim";
      if (studentsButton) studentsButton.textContent = "Öğrenci Listem";
    } else if (role === "coordinator") {
      if (dashboardButton) dashboardButton.textContent = "Operasyon";
      if (studentsButton) studentsButton.textContent = "Yeni Kayıt";
    } else {
      if (dashboardButton) dashboardButton.textContent = "Panel";
      if (studentsButton) studentsButton.textContent = "Öğrenciler";
    }
  }

  function showApp() {
    els.loginView.classList.add("hidden");
    els.appShell.classList.remove("hidden");
    els.userBadge.textContent = `${state.user.fullName} · ${state.user.roleLabel}`;
    updateRoleMenuLabels();
    applyPermissions();
  }

  function applyPermissions() {
    $$("[data-permission]").forEach((element) => {
      element.classList.toggle("hidden", !can(element.dataset.permission));
    });
    $$("[data-requires]").forEach((element) => {
      element.classList.toggle("hidden", !can(element.dataset.requires));
    });
    const activeButton = $(`.nav-button[data-view="${state.activeView}"]`);
    if (activeButton?.classList.contains("hidden")) {
      const firstVisible = $$(".nav-button").find((button) => !button.classList.contains("hidden"));
      if (firstVisible) switchView(firstVisible.dataset.view);
    }
  }

  function updatePageMeta(viewId) {
    const [title, subtitle] = viewMeta[viewId] || viewMeta.dashboardView;
    els.pageTitle.textContent = title;
    els.pageSubtitle.textContent = subtitle;
  }

  function switchView(viewId) {
    state.activeView = viewId;
    updatePageMeta(viewId);
    closeMobileMenu();
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
    $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));

    if (viewId === "dashboardView") loadDashboard();
    if (viewId === "studentsView") loadStudents();
    if (viewId === "attendanceView") loadAttendance();
    if (viewId === "paymentsView") loadPayments();
    if (viewId === "usersView") loadUsers();
    if (viewId === "backupView") loadBackups();
  }

  async function loadSettings() {
    state.settings = await api("/api/settings");
  }

  function metricCard(label, value, tone, text) {
    return `
      <article class="metric-card ${tone || ""}">
        <span>${escapeHtml(label)}</span>
        <strong>${value}</strong>
        <em>${escapeHtml(text || "")}</em>
      </article>
    `;
  }

  function renderTodayLessons() {
    const day = todayName().toLocaleLowerCase("tr-TR");
    const lessons = [];
    for (const student of state.students) {
      for (const lesson of student.lessons || []) {
        if (String(lesson.day || "").toLocaleLowerCase("tr-TR") === day) {
          lessons.push({ student, lesson });
        }
      }
    }
    lessons.sort((a, b) => String(a.lesson.time || "").localeCompare(String(b.lesson.time || ""), "tr"));
    els.todayLessons.innerHTML = lessons.length
      ? lessons.slice(0, 8).map(({ student, lesson }) => `
          <div class="compact-item">
            <div><strong>${escapeHtml(lesson.time || "-")}</strong><span>${escapeHtml(student.fullName)}</span></div>
            ${statusBadge(student.status)}
          </div>
        `).join("")
      : emptyState("Bugün için ders görünmüyor.", "Ders atamaları öğrencilerin kayıtlı saatlerinden okunur.");
  }

  function renderRecentStudents() {
    const recent = [...state.students]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 6);
    els.recentStudents.innerHTML = recent.length
      ? recent.map((student) => `
          <div class="compact-item">
            <div><strong>${escapeHtml(student.fullName)}</strong><span>${recordNo(student)} · ${escapeHtml(student.program || "-")}</span></div>
            ${statusBadge(student.status)}
          </div>
        `).join("")
      : emptyState("Henüz öğrenci bulunamadı.", "Yeni kayıtlar burada görünür.");
  }

  function paymentStatus(payment) {
    const paid = Number(payment.paidAmount || 0);
    const remaining = Number(payment.remainingAmount ?? Math.max(0, Number(payment.monthlyFee || 0) - paid));
    if (remaining <= 0 && paid > 0) return "paid";
    if (paid > 0) return "partial";
    return "unpaid";
  }

  function paymentStatusBadge(status) {
    const labels = {
      paid: "Ödendi",
      partial: "Kısmi",
      unpaid: "Ödenmedi"
    };
    const className = status === "paid" ? "good" : status === "partial" ? "warn" : "bad";
    return `<span class="badge ${className}">${labels[status] || "Ödenmedi"}</span>`;
  }

  function renderPaymentWaiting() {
    if (!can("payments:read")) {
      els.paymentWaiting.innerHTML = emptyState("Finans görünümü kapalı.", "Bu rol ödeme bilgisi göremez.");
      return;
    }
    const waiting = buildPaymentRows().filter((payment) => paymentStatus(payment) !== "paid").slice(0, 6);
    els.paymentWaiting.innerHTML = waiting.length
      ? waiting.map((payment) => `
          <div class="compact-item">
            <div><strong>${escapeHtml(payment.studentName)}</strong><span>${monthLabel(payment.periodMonth)} · ${money(payment.remainingAmount)}</span></div>
            ${paymentStatusBadge(paymentStatus(payment))}
          </div>
        `).join("")
      : emptyState("Bekleyen ödeme görünmüyor.", "Seçili ay için tüm kayıtlar dengede.");
  }

  function renderAttendanceSummary(items) {
    els.attendanceSummary.innerHTML = items.length
      ? items.map((item) => `
          <div class="status-row">
            <strong>${escapeHtml(statusLabels[item.status] || item.status)}</strong>
            <span class="badge">${item.total}</span>
          </div>
        `).join("")
      : emptyState("Yoklama kaydı bulunamadı.", "Son 30 güne ait kayıt yok.");
  }

  function renderRevenueChart(items) {
    if (!can("payments:read")) {
      els.revenueChart.innerHTML = emptyState("Finans görünümü kapalı.", "Bu rol tahsilat grafiği göremez.");
      return;
    }
    const maxRevenue = Math.max(1, ...items.map((item) => Number(item.total || 0)));
    els.revenueChart.innerHTML = items.length
      ? items.map((item) => `
          <div class="bar-row">
            <span class="bar-label">${escapeHtml(monthLabel(item.month))}</span>
            <span class="bar-track"><span class="bar-fill" style="--fill:${Math.max(4, (item.total / maxRevenue) * 100)}%"></span></span>
            <span class="bar-value">${money(item.total)}</span>
          </div>
        `).join("")
      : emptyState("Henüz tahsilat kaydı yok.", "Ödemeler eklendikçe grafik oluşur.");
  }

  async function loadDashboard() {
    if (!can("dashboard:read")) return;
    els.dashboardCards.innerHTML = emptyState("Veriler yükleniyor...", "Panel özeti hazırlanıyor.");
    const [dashboard, paymentData] = await Promise.all([
      api("/api/dashboard"),
      can("payments:read") ? api(`/api/payments?month=${encodeURIComponent(monthValue())}`) : Promise.resolve({ payments: [] })
    ]);
    if (paymentData.payments) state.payments = paymentData.payments;
    const totalAttendance = (dashboard.attendance || []).reduce((sum, item) => sum + Number(item.total || 0), 0);
    els.dashboardCards.innerHTML = [
      metricCard("Toplam Öğrenci", dashboard.students?.total ?? 0, "navy", "Kulüp kayıtları"),
      metricCard("Aktif Öğrenci", dashboard.students?.active ?? 0, "green", "Devam eden kayıt"),
      metricCard("Bu Ay Tahsilat", money(dashboard.currentMonthPaid), "gold", "Toplam ödeme"),
      metricCard("Bekleyen Ödeme", money(dashboard.currentMonthDebt), "red", "Kalan bakiye"),
      metricCard("Bugünkü Dersler", getTodayLessonCount(), "navy", todayName()),
      metricCard("Yoklama Durumu", totalAttendance, "green", "Son 30 gün")
    ].join("");
    renderRevenueChart(dashboard.monthlyRevenue || []);
    renderAttendanceSummary(dashboard.attendance || []);
    renderTodayLessons();
    renderRecentStudents();
    renderPaymentWaiting();
  }

  function getTodayLessonCount() {
    const day = todayName().toLocaleLowerCase("tr-TR");
    return state.students.reduce((total, student) => (
      total + (student.lessons || []).filter((lesson) => String(lesson.day || "").toLocaleLowerCase("tr-TR") === day).length
    ), 0);
  }

  async function loadStudents() {
    if (!can("students:read")) return;
    const q = els.globalSearch.value.trim();
    const status = els.studentStatusFilter.value;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status && status !== "all") params.set("status", status);
    els.studentTable.innerHTML = emptyRow(8, "Veriler yükleniyor...", "Öğrenci listesi hazırlanıyor.");
    const data = await api(`/api/students?${params}`);
    state.students = data.students || [];
    renderStudents();
    fillStudentSelects();
    if (state.activeView === "dashboardView") {
      renderTodayLessons();
      renderRecentStudents();
      renderPaymentWaiting();
    }
  }

  function renderStudents() {
    els.studentCount.textContent = `${state.students.length} kayıt`;
    if (!state.students.length) {
      els.studentTable.innerHTML = emptyRow(8, "Henüz öğrenci bulunamadı.", "Filtreyi temizleyebilir veya yeni kayıt ekleyebilirsiniz.");
      return;
    }
    els.studentTable.innerHTML = state.students.map((student) => {
      const detail = state.studentDetails[student.id];
      const detailRow = state.openStudentId === String(student.id) && detail ? renderStudentDetailRow(detail) : "";
      return `
        <tr class="student-row">
          <td data-label="Kayıt No"><span class="record-code">${recordNo(student)}</span></td>
          <td data-label="Ad Soyad"><strong>${escapeHtml(student.fullName)}</strong><br><span class="muted">${escapeHtml(student.level || "-")}</span></td>
          <td data-label="Branş / Program">${escapeHtml(student.program || "-")}</td>
          <td data-label="Grup / Saat">${escapeHtml(lessonText(student) || "-")}</td>
          <td data-label="Veli">${escapeHtml(student.parentName || "-")}</td>
          <td data-label="Telefon">${escapeHtml(student.phone || "-")}</td>
          <td data-label="Durum">${statusBadge(student.status)}</td>
          <td data-label="İşlem">
            <details class="row-menu">
              <summary>İşlemler</summary>
              <div>
                <button class="small-button secondary" data-action="detail-student" data-id="${student.id}" type="button">Detay</button>
                ${can("students:write") ? `<button class="small-button" data-action="edit-student" data-id="${student.id}" type="button">Düzenle</button>` : ""}
                ${can("students:delete") ? `<button class="small-button danger" data-action="delete-student" data-id="${student.id}" type="button">Sil</button>` : ""}
              </div>
            </details>
          </td>
        </tr>
        ${detailRow}
      `;
    }).join("");
  }

  function renderStudentDetailRow(data) {
    const student = data.student;
    const paymentTotal = (data.payments || []).reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
    return `
      <tr class="student-detail-row">
        <td colspan="8">
          <div class="inline-detail">
            <div>
              <h3>${escapeHtml(student.fullName)}</h3>
              <p>${recordNo(student)} · ${escapeHtml(student.program || "-")} · ${escapeHtml(student.level || "-")}</p>
            </div>
            <div class="detail-list">
              <div><span>Veli</span><strong>${escapeHtml(student.parentName || "-")}</strong></div>
              <div><span>Telefon</span><strong>${escapeHtml(student.phone || "-")}</strong></div>
              <div><span>Aylık Ücret</span><strong>${money(student.monthlyFee)}</strong></div>
              <div><span>Toplam Tahsilat</span><strong>${money(paymentTotal)}</strong></div>
              <div><span>Dersler</span><strong>${escapeHtml(lessonText(student) || "-")}</strong></div>
            </div>
            <div class="status-stack">
              ${(data.payments || []).slice(0, 4).map((payment) => `
                <div class="status-row"><strong>${monthLabel(payment.periodMonth)}</strong><span>${money(payment.paidAmount)}</span></div>
              `).join("") || emptyState("Ödeme kaydı yok.", "Bu öğrenci için ödeme görünmüyor.")}
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  function fillStudentSelects() {
    const options = state.students.length
      ? state.students.map((student) => `<option value="${student.id}" data-fee="${student.monthlyFee}">${escapeHtml(student.fullName)}</option>`).join("")
      : `<option value="">Öğrenci bulunamadı</option>`;
    els.attendanceStudent.innerHTML = options;
    els.paymentStudent.innerHTML = options;
    syncPaymentFee();
  }

  function clearStudentForm() {
    els.studentForm.reset();
    $("#studentId").value = "";
    $("#studentRegistrationDate").value = new Date().toISOString().slice(0, 10);
    $("#studentStatus").value = "Aktif";
    $("#studentProgram").value = "Yüzme";
    $("#studentLevel").value = "Başlangıç";
    $("#studentPackageCode").value = "GRUP-YUZME";
    $("#studentPackageName").value = "Grup Yüzme";
    $("#studentTotalSessions").value = "8";
    $("#studentSwimmingSessions").value = "8";
    $("#studentSportSessions").value = "0";
    $("#studentMonthlyFee").value = "6000";
  }

  function openStudentEditor(student) {
    clearStudentForm();
    els.studentEditor.classList.remove("hidden");
    if (!student) return;
    $("#studentId").value = student.id;
    $("#studentStatus").value = student.status;
    $("#studentFullName").value = student.fullName || "";
    $("#studentProgram").value = student.program || "";
    $("#studentLevel").value = student.level || "Başlangıç";
    $("#studentPackageCode").value = student.packageCode || "";
    $("#studentPackageName").value = student.packageName || "";
    $("#studentParentName").value = student.parentName || "";
    $("#studentPhone").value = student.phone || "";
    $("#studentTotalSessions").value = student.monthlyTotalSessions || 0;
    $("#studentSwimmingSessions").value = student.monthlySwimmingSessions || 0;
    $("#studentSportSessions").value = student.monthlySportSessions || 0;
    $("#studentMonthlyFee").value = student.monthlyFee || 0;
    $("#studentRegistrationDate").value = String(student.registrationDate || "").slice(0, 10);
    $("#studentSocial").value = student.socialMediaPermission ? "true" : "false";
    $("#studentNote").value = student.note || "";
    (student.lessons || []).slice(0, 4).forEach((lesson, index) => {
      $(`#lessonDay${index + 1}`).value = lesson.day || "";
      $(`#lessonTime${index + 1}`).value = lesson.time || "";
    });
  }

  function readLessons() {
    const lessons = [];
    for (let index = 1; index <= 4; index += 1) {
      const day = $(`#lessonDay${index}`).value.trim();
      const time = $(`#lessonTime${index}`).value.trim();
      if (day && time) lessons.push({ day, time });
    }
    return lessons;
  }

  function readStudentForm() {
    return {
      status: $("#studentStatus").value,
      fullName: $("#studentFullName").value.trim(),
      birthYear: Number($("#studentBirthYear").value || 0) || null,
      ageGroup: $("#studentAgeGroup").value.trim(),
      program: $("#studentProgram").value.trim(),
      level: $("#studentLevel").value,
      packageCode: $("#studentPackageCode").value.trim(),
      packageName: $("#studentPackageName").value.trim(),
      parentName: $("#studentParentName").value.trim(),
      phone: $("#studentPhone").value.trim(),
      alternatePhone: $("#studentAlternatePhone").value.trim(),
      socialMediaPermission: $("#studentSocial").value === "true",
      monthlyTotalSessions: Number($("#studentTotalSessions").value || 0),
      monthlySwimmingSessions: Number($("#studentSwimmingSessions").value || 0),
      monthlySportSessions: Number($("#studentSportSessions").value || 0),
      monthlyFee: Number($("#studentMonthlyFee").value || 0),
      registrationDate: $("#studentRegistrationDate").value,
      note: $("#studentNote").value.trim(),
      lessons: readLessons()
    };
  }

  async function showStudentDetail(id) {
    if (state.openStudentId === String(id) && state.studentDetails[id]) {
      state.openStudentId = null;
      renderStudents();
      return;
    }
    const data = await api(`/api/students/${id}`);
    state.studentDetails[id] = data;
    state.openStudentId = String(id);
    renderStudents();
  }

  async function loadAttendance() {
    if (!can("attendance:read")) return;
    const date = els.attendanceDate.value || new Date().toISOString().slice(0, 10);
    els.attendanceDate.value = date;
    if (!state.students.length) await loadStudents();
    renderAttendanceCards();
    els.attendanceTable.innerHTML = emptyRow(6, "Veriler yükleniyor...", "Yoklama kayıtları hazırlanıyor.");
    const data = await api(`/api/attendance?date=${encodeURIComponent(date)}`);
    state.attendance = data.attendance || [];
    els.attendanceTable.innerHTML = state.attendance.length
      ? state.attendance.map((item) => `
          <tr>
            <td data-label="Öğrenci"><strong>${escapeHtml(item.studentName)}</strong></td>
            <td data-label="Tarih">${dateLabel(item.lessonDate)}</td>
            <td data-label="Saat">${escapeHtml(item.startTime || "")}</td>
            <td data-label="Durum">${statusBadge(item.status)}</td>
            <td data-label="Not">${escapeHtml(item.note || "")}</td>
            <td data-label="Kaydeden">${escapeHtml(item.recordedByName || "")}</td>
          </tr>
        `).join("")
      : emptyRow(6, "Bu tarih için yoklama listesi boş.", "Ders seçip kayıt oluşturabilirsiniz.");
  }

  function renderAttendanceCards() {
    els.attendanceCards.innerHTML = state.students.length
      ? state.students.slice(0, 36).map((student) => {
        const firstLesson = (student.lessons || [])[0] || {};
        return `
          <article class="attendance-card">
            <div>
              <strong>${escapeHtml(student.fullName)}</strong>
              <span>${escapeHtml(firstLesson.day || "-")} · ${escapeHtml(firstLesson.time || "-")}</span>
            </div>
            <div class="attendance-actions" data-requires="attendance:write">
              <button class="small-button good" data-action="quick-attendance" data-id="${student.id}" data-status="present" type="button">Geldi</button>
              <button class="small-button danger" data-action="quick-attendance" data-id="${student.id}" data-status="absent" type="button">Gelmedi</button>
            </div>
          </article>
        `;
      }).join("")
      : emptyState("Bu saat için yoklama listesi boş.", "Önce öğrenci kaydı veya ders ataması gerekir.");
    applyPermissions();
  }

  async function submitAttendance(studentId, status) {
    const student = state.students.find((item) => String(item.id) === String(studentId));
    const firstLesson = (student?.lessons || [])[0] || {};
    await api("/api/attendance", {
      method: "POST",
      body: JSON.stringify({
        studentId,
        lessonDate: els.attendanceDate.value,
        dayOfWeek: firstLesson.day || $("#attendanceDay").value.trim(),
        startTime: firstLesson.time || $("#attendanceTime").value.trim(),
        status,
        note: $("#attendanceNote").value.trim()
      })
    });
  }

  function buildPaymentRows() {
    const byStudent = new Map(state.students.map((student) => [String(student.id), student]));
    const month = els.paymentMonthFilter.value || monthValue();
    const rows = state.payments.map((payment) => {
      const student = byStudent.get(String(payment.studentId)) || {};
      return {
        ...payment,
        phone: student.phone || "",
        parentName: student.parentName || "",
        program: student.program || ""
      };
    });
    const seen = new Set(rows.map((payment) => String(payment.studentId)));
    for (const student of state.students) {
      if (seen.has(String(student.id)) || Number(student.monthlyFee || 0) <= 0) continue;
      rows.push({
        id: null,
        studentId: student.id,
        studentName: student.fullName,
        parentName: student.parentName,
        phone: student.phone,
        periodMonth: `${month}-01`,
        monthlyFee: Number(student.monthlyFee || 0),
        paidAmount: 0,
        remainingAmount: Number(student.monthlyFee || 0),
        virtual: true
      });
    }
    return rows;
  }

  async function loadPayments() {
    if (!can("payments:read")) return;
    const month = els.paymentMonthFilter.value || monthValue();
    els.paymentMonthFilter.value = month;
    if (!state.students.length) await loadStudents();
    els.paymentTable.innerHTML = emptyRow(9, "Veriler yükleniyor...", "Ödeme kayıtları hazırlanıyor.");
    const data = await api(`/api/payments?month=${encodeURIComponent(month)}`);
    state.payments = data.payments || [];
    renderPayments();
  }

  function normalizePhoneForWhatsapp(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.startsWith("90")) return digits;
    if (digits.startsWith("0")) return `90${digits.slice(1)}`;
    if (digits.length === 10) return `90${digits}`;
    return digits;
  }

  function whatsappLink(payment) {
    const phone = normalizePhoneForWhatsapp(payment.phone);
    if (!phone) return "";
    const message = payment.remainingAmount > 0
      ? `Merhaba, ${payment.studentName} için ${monthLabel(payment.periodMonth)} döneminde kalan ödeme tutarı ${money(payment.remainingAmount)} görünmektedir.`
      : `Merhaba, ${payment.studentName} için ${monthLabel(payment.periodMonth)} dönemi ödemeniz alınmıştır. Teşekkür ederiz.`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  }

  function renderPaymentStats(rows) {
    const paid = rows.filter((payment) => paymentStatus(payment) === "paid").length;
    const partial = rows.filter((payment) => paymentStatus(payment) === "partial").length;
    const unpaid = rows.filter((payment) => paymentStatus(payment) === "unpaid").length;
    const paidTotal = rows.reduce((sum, payment) => sum + Number(payment.paidAmount || 0), 0);
    const remainingTotal = rows.reduce((sum, payment) => sum + Number(payment.remainingAmount || 0), 0);
    els.paymentStats.innerHTML = [
      metricCard("Ödeyen", paid, "green", "Tamamlandı"),
      metricCard("Kısmi", partial, "gold", "Takipte"),
      metricCard("Ödenmedi", unpaid, "red", "Bekliyor"),
      metricCard("Tahsilat", money(paidTotal), "navy", `Kalan ${money(remainingTotal)}`)
    ].join("");
  }

  function renderPayments() {
    const search = els.paymentSearch.value.trim().toLocaleLowerCase("tr-TR");
    const status = els.paymentStatusFilter.value;
    let rows = buildPaymentRows();
    if (search) {
      rows = rows.filter((payment) => (
        `${payment.studentName || ""} ${payment.parentName || ""} ${payment.phone || ""}`.toLocaleLowerCase("tr-TR").includes(search)
      ));
    }
    if (status !== "all") rows = rows.filter((payment) => paymentStatus(payment) === status);
    rows.sort((a, b) => String(a.studentName || "").localeCompare(String(b.studentName || ""), "tr"));
    renderPaymentStats(rows);
    els.paymentTable.innerHTML = rows.length
      ? rows.map((payment) => {
        const statusKey = paymentStatus(payment);
        const whatsApp = whatsappLink(payment);
        return `
          <tr>
            <td data-label="Öğrenci"><strong>${escapeHtml(payment.studentName)}</strong><br><span class="muted">${recordNo({ id: payment.studentId })}</span></td>
            <td data-label="Veli">${escapeHtml(payment.parentName || "-")}</td>
            <td data-label="Telefon">${escapeHtml(payment.phone || "-")}</td>
            <td data-label="Ay">${monthLabel(payment.periodMonth)}</td>
            <td data-label="Ücret" class="money">${money(payment.monthlyFee)}</td>
            <td data-label="Ödenen" class="money">${money(payment.paidAmount)}</td>
            <td data-label="Kalan" class="money">${money(payment.remainingAmount)}</td>
            <td data-label="Durum">${paymentStatusBadge(statusKey)}</td>
            <td data-label="İşlem">
              <div class="actions">
                ${whatsApp ? `<a class="small-button whatsapp" href="${whatsApp}" target="_blank" rel="noopener">WhatsApp</a>` : `<span class="small-button disabled">WhatsApp</span>`}
                ${can("payments:delete") && payment.id ? `<button class="small-button danger" data-action="delete-payment" data-id="${payment.id}" type="button">Sil</button>` : ""}
              </div>
            </td>
          </tr>
        `;
      }).join("")
      : emptyRow(9, "Bu ay ödeme kaydı bulunamadı.", "Filtreleri değiştirerek tekrar deneyebilirsiniz.");
  }

  function syncPaymentFee() {
    const option = els.paymentStudent.selectedOptions[0];
    if (option) els.paymentMonthlyFee.value = option.dataset.fee || 0;
  }

  async function loadUsers() {
    if (!can("users:read")) return;
    const data = await api("/api/users");
    const users = data.users || [];
    els.userTable.innerHTML = users.length
      ? users.map((user) => `
          <tr>
            <td data-label="Kullanıcı adı"><strong>${escapeHtml(user.username)}</strong></td>
            <td data-label="Ad soyad">${escapeHtml(user.fullName)}</td>
            <td data-label="Rol">${roleBadge(user.normalizedRole || user.role, user.roleLabel)}</td>
            <td data-label="Durum">${user.active ? statusBadge("Aktif") : statusBadge("Pasif")}</td>
            <td data-label="Kulüp">${escapeHtml(user.clubId ? `Kulüp #${user.clubId}` : "-")}</td>
            <td data-label="Yetki özeti">${escapeHtml((user.permissions || []).slice(0, 4).join(", "))}${(user.permissions || []).length > 4 ? "..." : ""}</td>
          </tr>
        `).join("")
      : emptyRow(6, "Kullanıcı bulunamadı.", "Bu kulüp için kullanıcı kaydı görünmüyor.");
  }

  async function loadBackups() {
    if (!can("backup:read")) return;
    const [backups, logs] = await Promise.all([
      api("/api/backups"),
      can("audit:read") ? api("/api/audit-logs") : Promise.resolve({ logs: [] })
    ]);
    els.backupTable.innerHTML = backups.backups.length
      ? backups.backups.map((backup) => `
          <tr>
            <td data-label="Dosya"><strong>${escapeHtml(backup.filename)}</strong></td>
            <td data-label="Boyut">${Math.round(Number(backup.file_size || 0) / 1024)} KB</td>
            <td data-label="Kayıt sayıları">${escapeHtml(Object.entries(backup.row_counts || {}).map(([key, value]) => `${key}: ${value}`).join(" · "))}</td>
            <td data-label="Tarih">${dateLabel(backup.created_at)}</td>
          </tr>
        `).join("")
      : emptyRow(4, "Henüz yedek kaydı yok.", "Yedek alındığında burada görünür.");

    els.auditLogList.innerHTML = logs.logs.length
      ? logs.logs.slice(0, 30).map((log) => `
          <div class="audit-item">
            <div><strong>${escapeHtml(log.action)} · ${escapeHtml(log.entity_type)}</strong><br><span class="muted">${escapeHtml(log.actor_name || "Sistem")}</span></div>
            <span>${dateLabel(log.created_at)}</span>
          </div>
        `).join("")
      : emptyState("İşlem kaydı görünmüyor.", "Yetkiniz varsa kayıtlar burada listelenir.");
  }

  async function bootstrap() {
    els.attendanceDate.value = new Date().toISOString().slice(0, 10);
    els.paymentDate.value = new Date().toISOString().slice(0, 10);
    els.paymentMonthFilter.value = monthValue();
    els.loginUsername.value = localStorage.getItem("emba.rememberedUsername") || "";
    els.rememberMe.checked = Boolean(els.loginUsername.value);
    clearStudentForm();

    try {
      const data = await api("/api/auth/me");
      state.user = data.user;
      showApp();
      await loadSettings();
      await loadStudents();
      await loadDashboard();
    } catch (_error) {
      showLogin();
    }
  }

  els.mobileMenuButton.addEventListener("click", openMobileMenu);
  els.sidebarOverlay.addEventListener("click", closeMobileMenu);

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.loginMessage.textContent = "";
    els.loginMessage.classList.remove("error");
    try {
      const username = els.loginUsername.value.trim();
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username,
          password: els.loginPassword.value
        })
      });
      if (els.rememberMe.checked) localStorage.setItem("emba.rememberedUsername", username);
      else localStorage.removeItem("emba.rememberedUsername");
      state.user = data.user;
      els.loginPassword.value = "";
      showApp();
      await loadSettings();
      await loadStudents();
      await loadDashboard();
    } catch (error) {
      els.loginMessage.textContent = error.message;
      els.loginMessage.classList.add("error");
    }
  });

  els.logoutButton.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });

  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  els.refreshDashboardButton.addEventListener("click", loadDashboard);
  els.studentStatusFilter.addEventListener("change", loadStudents);
  els.globalSearch.addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(loadStudents, 220);
  });

  els.newStudentButton.addEventListener("click", () => openStudentEditor());
  els.cancelStudentButton.addEventListener("click", () => els.studentEditor.classList.add("hidden"));

  els.studentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = $("#studentId").value;
    const method = id ? "PATCH" : "POST";
    const url = id ? `/api/students/${id}` : "/api/students";
    try {
      await api(url, { method, body: JSON.stringify(readStudentForm()) });
      els.studentEditor.classList.add("hidden");
      await loadStudents();
      await loadDashboard();
      setNotice(id ? "Öğrenci güncellendi." : "Öğrenci kaydedildi.");
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  document.body.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.action;
    try {
      if (action === "detail-student") await showStudentDetail(id);
      if (action === "edit-student") openStudentEditor(state.students.find((student) => String(student.id) === String(id)));
      if (action === "quick-attendance") {
        await submitAttendance(id, button.dataset.status);
        await loadAttendance();
        await loadDashboard();
        setNotice("Yoklama kaydedildi.");
      }
      if (action === "delete-student" && window.confirm("Bu öğrenci kaydı silinsin mi?")) {
        await api(`/api/students/${id}`, { method: "DELETE" });
        await loadStudents();
        await loadDashboard();
        setNotice("Öğrenci silindi.");
      }
      if (action === "delete-payment" && window.confirm("Bu ödeme kaydı silinsin mi?")) {
        await api(`/api/payments/${id}`, { method: "DELETE" });
        await loadPayments();
        await loadDashboard();
        setNotice("Ödeme silindi.");
      }
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  els.attendanceDate.addEventListener("change", loadAttendance);
  els.attendanceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/attendance", {
        method: "POST",
        body: JSON.stringify({
          studentId: els.attendanceStudent.value,
          lessonDate: els.attendanceDate.value,
          dayOfWeek: $("#attendanceDay").value.trim(),
          startTime: $("#attendanceTime").value.trim(),
          status: $("#attendanceStatus").value,
          note: $("#attendanceNote").value.trim()
        })
      });
      $("#attendanceNote").value = "";
      await loadAttendance();
      await loadDashboard();
      setNotice("Yoklama kaydedildi.");
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  els.paymentStudent.addEventListener("change", syncPaymentFee);
  els.paymentMonthFilter.addEventListener("change", loadPayments);
  els.paymentSearch.addEventListener("input", renderPayments);
  els.paymentStatusFilter.addEventListener("change", renderPayments);
  els.paymentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/payments", {
        method: "POST",
        body: JSON.stringify({
          studentId: els.paymentStudent.value,
          periodMonth: els.paymentMonthFilter.value,
          monthlyFee: els.paymentMonthlyFee.value,
          paidAmount: els.paymentPaidAmount.value,
          paymentDate: $("#paymentDate").value,
          method: $("#paymentMethod").value.trim(),
          description: $("#paymentDescription").value.trim()
        })
      });
      els.paymentPaidAmount.value = "";
      $("#paymentDescription").value = "";
      await loadPayments();
      await loadDashboard();
      setNotice("Ödeme kaydedildi.");
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  els.userForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username: $("#newUsername").value.trim(),
          fullName: $("#newUserFullName").value.trim(),
          role: $("#newUserRole").value,
          password: $("#newUserPassword").value
        })
      });
      els.userForm.reset();
      await loadUsers();
      setNotice("Kullanıcı eklendi.");
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  els.runBackupButton.addEventListener("click", async () => {
    try {
      await api("/api/backups/run", { method: "POST" });
      await loadBackups();
      setNotice("Yedek oluşturuldu.");
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  bootstrap();
})();
