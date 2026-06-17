(function () {
  const state = {
    user: null,
    settings: {},
    students: [],
    activeView: "dashboardView",
    searchTimer: null
  };

  const statusLabels = {
    present: "Geldi",
    absent: "Gelmedi",
    excused: "Mazeretli",
    planned: "Planlandı"
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const els = {
    loginView: $("#loginView"),
    appShell: $("#appShell"),
    loginForm: $("#loginForm"),
    loginUsername: $("#loginUsername"),
    loginPassword: $("#loginPassword"),
    loginMessage: $("#loginMessage"),
    notice: $("#notice"),
    userBadge: $("#userBadge"),
    logoutButton: $("#logoutButton"),
    globalSearch: $("#globalSearch"),
    dashboardCards: $("#dashboardCards"),
    revenueChart: $("#revenueChart"),
    attendanceSummary: $("#attendanceSummary"),
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
    attendanceTable: $("#attendanceTable"),
    paymentMonthFilter: $("#paymentMonthFilter"),
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

  function setNotice(message, isError) {
    els.notice.textContent = message || "";
    els.notice.classList.toggle("error", Boolean(isError));
    if (message && !isError) {
      window.setTimeout(() => {
        if (els.notice.textContent === message) els.notice.textContent = "";
      }, 3500);
    }
  }

  function can(permission) {
    return state.user?.permissions?.includes(permission);
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

  function showLogin() {
    state.user = null;
    els.loginView.classList.remove("hidden");
    els.appShell.classList.add("hidden");
  }

  function showApp() {
    els.loginView.classList.add("hidden");
    els.appShell.classList.remove("hidden");
    els.userBadge.textContent = `${state.user.fullName} · ${state.user.roleLabel}`;
    applyPermissions();
  }

  function applyPermissions() {
    $$("[data-permission]").forEach((element) => {
      element.classList.toggle("hidden", !can(element.dataset.permission));
    });
    $$("[data-requires]").forEach((element) => {
      element.classList.toggle("hidden", !can(element.dataset.requires));
    });
  }

  function switchView(viewId) {
    state.activeView = viewId;
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
    $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));

    if (viewId === "dashboardView") loadDashboard();
    if (viewId === "studentsView") loadStudents();
    if (viewId === "attendanceView") loadAttendance();
    if (viewId === "paymentsView") loadPayments();
    if (viewId === "usersView") loadUsers();
    if (viewId === "backupView") loadBackups();
  }

  function statusBadge(status) {
    const className = status === "Aktif" || status === "present" ? "good" : status === "Bekleyen" || status === "excused" ? "warn" : "bad";
    return `<span class="badge ${className}">${escapeHtml(statusLabels[status] || status)}</span>`;
  }

  function emptyRow(cols, message) {
    return `<tr><td colspan="${cols}" class="muted">${escapeHtml(message)}</td></tr>`;
  }

  async function loadSettings() {
    state.settings = await api("/api/settings");
  }

  async function loadDashboard() {
    if (!can("dashboard:read")) return;
    const dashboard = await api("/api/dashboard");
    els.dashboardCards.innerHTML = [
      ["Toplam Öğrenci", dashboard.students.total],
      ["Aktif Öğrenci", dashboard.students.active],
      ["Bekleyen", dashboard.students.waiting],
      ["Bu Ay Tahsilat", money(dashboard.currentMonthPaid)],
      ["Bu Ay Kalan", money(dashboard.currentMonthDebt)]
    ].map(([label, value]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong></article>`).join("");

    const maxRevenue = Math.max(1, ...dashboard.monthlyRevenue.map((item) => Number(item.total || 0)));
    els.revenueChart.innerHTML = dashboard.monthlyRevenue.length
      ? dashboard.monthlyRevenue.map((item) => `
          <div class="bar-row">
            <span class="bar-label">${escapeHtml(monthLabel(item.month))}</span>
            <span class="bar-track"><span class="bar-fill" style="--fill:${Math.max(3, (item.total / maxRevenue) * 100)}%"></span></span>
            <span class="bar-value">${money(item.total)}</span>
          </div>
        `).join("")
      : `<p class="muted">Henüz tahsilat kaydı yok.</p>`;

    els.attendanceSummary.innerHTML = dashboard.attendance.length
      ? dashboard.attendance.map((item) => `
          <div class="status-row">
            <strong>${statusLabels[item.status] || item.status}</strong>
            <span class="badge">${item.total}</span>
          </div>
        `).join("")
      : `<p class="muted">Son 30 gün için yoklama kaydı yok.</p>`;
  }

  async function loadStudents() {
    if (!can("students:read")) return;
    const q = els.globalSearch.value.trim();
    const status = els.studentStatusFilter.value;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status && status !== "all") params.set("status", status);
    const data = await api(`/api/students?${params}`);
    state.students = data.students;
    renderStudents();
    fillStudentSelects();
  }

  function renderStudents() {
    els.studentCount.textContent = `${state.students.length} kayıt`;
    els.studentTable.innerHTML = state.students.length
      ? state.students.map((student) => `
          <tr>
            <td><strong>${escapeHtml(student.fullName)}</strong><br><span class="muted">#${student.id}</span></td>
            <td>${statusBadge(student.status)}</td>
            <td>${escapeHtml(student.program || "")}</td>
            <td>${escapeHtml(student.level || "")}</td>
            <td>${escapeHtml(student.parentName || "")}</td>
            <td>${escapeHtml(student.phone || "")}</td>
            <td>${escapeHtml((student.lessons || []).map((item) => `${item.day} ${item.time}`).join(" / "))}</td>
            <td>
              <div class="actions">
                <button class="small-button secondary" data-action="detail-student" data-id="${student.id}">Detay</button>
                ${can("students:write") ? `<button class="small-button" data-action="edit-student" data-id="${student.id}">Düzenle</button>` : ""}
                ${can("students:delete") ? `<button class="small-button danger" data-action="delete-student" data-id="${student.id}">Sil</button>` : ""}
              </div>
            </td>
          </tr>
        `).join("")
      : emptyRow(8, "Kayıt bulunamadı.");
  }

  function fillStudentSelects() {
    const options = state.students.map((student) => (
      `<option value="${student.id}" data-fee="${student.monthlyFee}">${escapeHtml(student.fullName)}</option>`
    )).join("");
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
      program: $("#studentProgram").value.trim(),
      level: $("#studentLevel").value,
      packageCode: $("#studentPackageCode").value.trim(),
      packageName: $("#studentPackageName").value.trim(),
      parentName: $("#studentParentName").value.trim(),
      phone: $("#studentPhone").value.trim(),
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
    const data = await api(`/api/students/${id}`);
    const student = data.student;
    const paymentTotal = data.payments.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
    els.studentDetail.classList.remove("hidden");
    els.studentDetail.innerHTML = `
      <div class="section-head">
        <div>
          <h2>${escapeHtml(student.fullName)}</h2>
          <p>${escapeHtml(student.program || "")} · ${escapeHtml(student.level || "")}</p>
        </div>
        ${statusBadge(student.status)}
      </div>
      <div class="detail-grid">
        <div class="detail-list">
          <div><span>Veli</span><strong>${escapeHtml(student.parentName || "-")}</strong></div>
          <div><span>Telefon</span><strong>${escapeHtml(student.phone || "-")}</strong></div>
          <div><span>Aylık Ücret</span><strong>${money(student.monthlyFee)}</strong></div>
          <div><span>Toplam Tahsilat</span><strong>${money(paymentTotal)}</strong></div>
          <div><span>Dersler</span><strong>${escapeHtml((student.lessons || []).map((item) => `${item.day} ${item.time}`).join(" / ") || "-")}</strong></div>
        </div>
        <div>
          <h3>Son Ödemeler</h3>
          <div class="status-stack">
            ${data.payments.slice(0, 5).map((payment) => `
              <div class="status-row"><strong>${monthLabel(payment.periodMonth)}</strong><span>${money(payment.paidAmount)}</span></div>
            `).join("") || `<p class="muted">Ödeme kaydı yok.</p>`}
          </div>
        </div>
      </div>
    `;
    els.studentDetail.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadAttendance() {
    if (!can("attendance:read")) return;
    const date = els.attendanceDate.value || new Date().toISOString().slice(0, 10);
    els.attendanceDate.value = date;
    if (!state.students.length) await loadStudents();
    const data = await api(`/api/attendance?date=${encodeURIComponent(date)}`);
    els.attendanceTable.innerHTML = data.attendance.length
      ? data.attendance.map((item) => `
          <tr>
            <td><strong>${escapeHtml(item.studentName)}</strong></td>
            <td>${dateLabel(item.lessonDate)}</td>
            <td>${escapeHtml(item.startTime || "")}</td>
            <td>${statusBadge(item.status)}</td>
            <td>${escapeHtml(item.note || "")}</td>
            <td>${escapeHtml(item.recordedByName || "")}</td>
          </tr>
        `).join("")
      : emptyRow(6, "Bu tarih için yoklama kaydı yok.");
  }

  async function loadPayments() {
    if (!can("payments:read")) return;
    const month = els.paymentMonthFilter.value || monthValue();
    els.paymentMonthFilter.value = month;
    if (!state.students.length) await loadStudents();
    const data = await api(`/api/payments?month=${encodeURIComponent(month)}`);
    els.paymentTable.innerHTML = data.payments.length
      ? data.payments.map((payment) => `
          <tr>
            <td><strong>${escapeHtml(payment.studentName)}</strong></td>
            <td>${monthLabel(payment.periodMonth)}</td>
            <td class="money">${money(payment.monthlyFee)}</td>
            <td class="money">${money(payment.paidAmount)}</td>
            <td class="money">${money(payment.remainingAmount)}</td>
            <td>${dateLabel(payment.paymentDate)}</td>
            <td>${escapeHtml(payment.description || payment.method || "")}</td>
            <td>${can("payments:delete") ? `<button class="small-button danger" data-action="delete-payment" data-id="${payment.id}">Sil</button>` : ""}</td>
          </tr>
        `).join("")
      : emptyRow(8, "Bu ay için ödeme kaydı yok.");
  }

  function syncPaymentFee() {
    const option = els.paymentStudent.selectedOptions[0];
    if (option) els.paymentMonthlyFee.value = option.dataset.fee || 0;
  }

  async function loadUsers() {
    if (!can("users:read")) return;
    const data = await api("/api/users");
    els.userTable.innerHTML = data.users.length
      ? data.users.map((user) => `
          <tr>
            <td><strong>${escapeHtml(user.fullName)}</strong><br><span class="muted">${escapeHtml(user.username)}</span></td>
            <td>${escapeHtml(user.roleLabel)}</td>
            <td>${user.active ? statusBadge("Aktif") : statusBadge("Pasif")}</td>
            <td>${escapeHtml((user.permissions || []).join(", "))}</td>
          </tr>
        `).join("")
      : emptyRow(4, "Kullanıcı bulunamadı.");
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
            <td><strong>${escapeHtml(backup.filename)}</strong></td>
            <td>${Math.round(Number(backup.file_size || 0) / 1024)} KB</td>
            <td>${escapeHtml(Object.entries(backup.row_counts || {}).map(([key, value]) => `${key}: ${value}`).join(" · "))}</td>
            <td>${dateLabel(backup.created_at)}</td>
          </tr>
        `).join("")
      : emptyRow(4, "Henüz yedek kaydı yok.");

    els.auditLogList.innerHTML = logs.logs.length
      ? logs.logs.slice(0, 30).map((log) => `
          <div class="audit-item">
            <div><strong>${escapeHtml(log.action)} · ${escapeHtml(log.entity_type)}</strong><br><span class="muted">${escapeHtml(log.actor_name || "Sistem")}</span></div>
            <span>${dateLabel(log.created_at)}</span>
          </div>
        `).join("")
      : `<p class="muted">İşlem kaydı görünmüyor.</p>`;
  }

  async function bootstrap() {
    els.attendanceDate.value = new Date().toISOString().slice(0, 10);
    els.paymentDate.value = new Date().toISOString().slice(0, 10);
    els.paymentMonthFilter.value = monthValue();
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

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.loginMessage.textContent = "";
    els.loginMessage.classList.remove("error");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: els.loginUsername.value.trim(),
          password: els.loginPassword.value
        })
      });
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
