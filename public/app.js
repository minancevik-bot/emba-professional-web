(function () {
  const state = {
    user: null,
    settings: {},
    students: [],
    payments: [],
    attendance: [],
    lessonAttendance: [],
    attendanceSlots: [],
    attendanceReport: [],
    attendanceReportSessions: [],
    attendanceReportDetails: {},
    editingReportSessionId: null,
    pendingAttendanceResetSessionId: null,
    pendingAttendanceClearContext: null,
    clubs: [],
    users: [],
    selectedClub: null,
    importPreview: null,
    studentDetails: {},
    openStudentId: null,
    openStudentActionsId: null,
    editingStudentInlineId: null,
    editingPaymentId: null,
    editingPaymentRowKey: null,
    activeView: "superAdminView",
    pendingAttendanceTime: null,
    attendanceTimesOpen: false,
    attendanceListCollapsed: false,
    manualAttendanceOpen: false,
    manualAttendanceResults: [],
    manualAttendanceTimer: null,
    searchTimer: null,
    userSearchTimer: null,
    studentSaving: false
  };

  const statusLabels = {
    present: "Geldi",
    absent: "Gelmedi",
    excused: "Mazeretli",
    planned: "Planlandı"
  };

  const lessonDays = ["", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
  const lessonTimes = Array.from({ length: 26 }, (_, index) => {
    const totalMinutes = 9 * 60 + index * 30;
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  });

  const sessionKeys = {
    appActive: "kulupasist.appActive",
    activeView: "kulupasist.activeView",
    selectedClub: "kulupasist.selectedClub"
  };

  const viewMeta = {
    superAdminView: ["Kulüp Asistanı Merkez", "Kulüp ve kullanıcı yönetim merkezi"],
    dashboardView: ["Yönetim Paneli", "Kulüp operasyonlarını tek ekrandan takip edin."],
    studentsView: ["Öğrenciler", "Kayıt, ders ve veli bilgilerini düzenleyin."],
    attendanceView: ["Yoklama", "Günlük ders katılımını hızlıca yönetin."],
    studentCreateView: ["Öğrenci Ekle", "Hızlı öğrenci kaydı oluşturun."],
    paymentsView: ["Ödemeler", "Tahsilat, kalan bakiye ve WhatsApp takibini yapın."],
    importView: ["Toplu İçe Aktar", "Excel listesini önce önizleyin, sonra onaylayarak aktarın."],
    usersView: ["Kullanıcılar", "Otomasyon ve kulüp kullanıcılarını tek yerden yönetin."],
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
    continueSessionButton: $("#continueSessionButton"),
    loginMessage: $("#loginMessage"),
    sidebar: $("#sidebar"),
    sidebarOverlay: $("#sidebarOverlay"),
    mobileMenuButton: $("#mobileMenuButton"),
    pageTitle: $("#pageTitle"),
    pageSubtitle: $("#pageSubtitle"),
    notice: $("#notice"),
    userBadge: $("#userBadge"),
    logoutButton: $("#logoutButton"),
    brandHomeButton: $("#brandHomeButton"),
    mobileBrandHomeButton: $("#mobileBrandHomeButton"),
    backToClubsButton: $("#backToClubsButton"),
    clubContextLabel: $("#clubContextLabel"),
    topClubLogo: $("#topClubLogo"),
    topClubLogoImage: $("#topClubLogoImage"),
    topClubLogoFallback: $("#topClubLogoFallback"),
    globalSearch: $("#globalSearch"),
    globalSearchButton: $("#globalSearchButton"),
    globalSearchClearButton: $("#globalSearchClearButton"),
    superAdminCards: $("#superAdminCards"),
    clubGrid: $("#clubGrid"),
    clubForm: $("#clubForm"),
    clubCreateUser: $("#clubCreateUser"),
    clubUserFields: $("#clubUserFields"),
    clubAdminPasswordConfirm: $("#clubAdminPasswordConfirm"),
    dashboardClubLogo: $("#dashboardClubLogo"),
    dashboardClubFallback: $("#dashboardClubFallback"),
    dashboardClubName: $("#dashboardClubName"),
    dashboardEyebrow: $("#dashboardEyebrow"),
    dashboardDescription: $("#dashboardDescription"),
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
    attendanceSlotTime: $("#attendanceSlotTime"),
    attendanceTimePicker: $("#attendanceTimePicker"),
    attendanceTimeToggle: $("#attendanceTimeToggle"),
    attendanceSelectedTime: $("#attendanceSelectedTime"),
    attendanceTimeSummary: $("#attendanceTimeSummary"),
    attendanceTimePanel: $("#attendanceTimePanel"),
    attendanceTimeGrid: $("#attendanceTimeGrid"),
    attendanceCardSearch: $("#attendanceCardSearch"),
    attendanceUnmarkedCount: $("#attendanceUnmarkedCount"),
    manualAttendanceToggle: $("#manualAttendanceToggle"),
    manualAttendancePanel: $("#manualAttendancePanel"),
    manualAttendanceSearch: $("#manualAttendanceSearch"),
    manualAttendanceResults: $("#manualAttendanceResults"),
    lessonAttendanceCards: $("#lessonAttendanceCards"),
    saveBulkAttendanceButton: $("#saveBulkAttendanceButton"),
    clearAttendanceButton: $("#clearAttendanceButton"),
    attendanceForm: $("#attendanceForm"),
    attendanceStudent: $("#attendanceStudent"),
    attendanceCards: $("#attendanceCards"),
    attendanceTable: $("#attendanceTable"),
    attendanceReportForm: $("#attendanceReportForm"),
    reportType: $("#reportType"),
    reportDate: $("#reportDate"),
    reportWeekStart: $("#reportWeekStart"),
    reportWeekWrap: $("#reportWeekWrap"),
    reportTime: $("#reportTime"),
    reportCoach: $("#reportCoach"),
    reportStatus: $("#reportStatus"),
    reportClub: $("#reportClub"),
    reportClubFilterWrap: $("#reportClubFilterWrap"),
    printAttendanceReportButton: $("#printAttendanceReportButton"),
    attendanceReportSummary: $("#attendanceReportSummary"),
    attendanceReportSessions: $("#attendanceReportSessions"),
    attendanceResetModal: $("#attendanceResetModal"),
    attendanceResetSessionLabel: $("#attendanceResetSessionLabel"),
    attendanceResetConfirmInput: $("#attendanceResetConfirmInput"),
    confirmAttendanceResetButton: $("#confirmAttendanceResetButton"),
    cancelAttendanceResetButton: $("#cancelAttendanceResetButton"),
    printReport: $("#attendancePrintRoot"),
    paymentMonthFilter: $("#paymentMonthFilter"),
    paymentSearch: $("#paymentSearch"),
    paymentSearchButton: $("#paymentSearchButton"),
    paymentSearchClearButton: $("#paymentSearchClearButton"),
    paymentStatusFilter: $("#paymentStatusFilter"),
    paymentStats: $("#paymentStats"),
    paymentForm: $("#paymentForm"),
    paymentId: $("#paymentId"),
    paymentStudent: $("#paymentStudent"),
    paymentMonthlyFee: $("#paymentMonthlyFee"),
    paymentPaidAmount: $("#paymentPaidAmount"),
    paymentEditStatus: $("#paymentEditStatus"),
    paymentPeriodMonth: $("#paymentPeriodMonth"),
    paymentDate: $("#paymentDate"),
    paymentMethod: $("#paymentMethod"),
    paymentDescription: $("#paymentDescription"),
    savePaymentButton: $("#savePaymentButton"),
    cancelPaymentEditButton: $("#cancelPaymentEditButton"),
    paymentTable: $("#paymentTable"),
    importForm: $("#importForm"),
    importFile: $("#importFile"),
    importCommitButton: $("#importCommitButton"),
    importSummary: $("#importSummary"),
    importErrorsPanel: $("#importErrorsPanel"),
    importErrors: $("#importErrors"),
    importPreviewTable: $("#importPreviewTable"),
    userForm: $("#userForm"),
    userTable: $("#userTable"),
    userSearch: $("#userSearch"),
    userSearchButton: $("#userSearchButton"),
    userSearchClearButton: $("#userSearchClearButton"),
    userRoleFilter: $("#userRoleFilter"),
    userClubFilter: $("#userClubFilter"),
    newUserButton: $("#newUserButton"),
    editUserId: $("#editUserId"),
    newUserRole: $("#newUserRole"),
    newUserClubId: $("#newUserClubId"),
    coachScopeHint: $("#coachScopeHint"),
    newUserActive: $("#newUserActive"),
    newUserPassword: $("#newUserPassword"),
    newUserPasswordConfirm: $("#newUserPasswordConfirm"),
    saveUserButton: $("#saveUserButton"),
    cancelUserEditButton: $("#cancelUserEditButton"),
    runBackupButton: $("#runBackupButton"),
    backupTable: $("#backupTable"),
    auditLogList: $("#auditLogList")
  };

  const studentEditorHome = els.studentEditor?.parentElement || null;

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

  function dateInputValue(value) {
    if (!value) return "";
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function addDaysValue(value, days) {
    const base = new Date(`${dateInputValue(value)}T12:00:00`);
    base.setDate(base.getDate() + days);
    return base.toISOString().slice(0, 10);
  }

  function weekStartValue(value) {
    const base = new Date(`${dateInputValue(value || new Date().toISOString().slice(0, 10))}T12:00:00`);
    const day = base.getDay() || 7;
    base.setDate(base.getDate() - day + 1);
    return base.toISOString().slice(0, 10);
  }

  function monthInputValue(value) {
    if (!value) return monthValue();
    const raw = String(value);
    if (/^\d{4}-\d{2}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0, 7);
    const dateValue = dateInputValue(value);
    return dateValue ? dateValue.slice(0, 7) : monthValue();
  }

  function monthLabel(value) {
    if (!value) return "";
    const month = monthInputValue(value);
    const [year, monthNumber] = month.split("-");
    const date = new Date(Number(year), Number(monthNumber) - 1, 1);
    return new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(date);
  }

  function studentEligibleForMonth(student, month) {
    if (String(student?.status || "Aktif") === "Aktif") return true;
    if (String(student?.status || "") !== "Pasif" || !student?.passiveDate) return false;
    const passive = new Date(`${dateInputValue(student.passiveDate)}T12:00:00`);
    const effective = new Date(passive.getFullYear(), passive.getMonth() + 1, 1, 12);
    const target = new Date(`${month || monthValue()}-01T12:00:00`);
    return target < effective;
  }

  function normalizeTimeValue(value) {
    const match = String(value || "").trim().replace(".", ":").match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
    if (!match) return "";
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || ![0, 30].includes(minute)) return "";
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function addMinutesToTime(value, minutes) {
    const time = normalizeTimeValue(value);
    if (!time) return "";
    const [hour, minute] = time.split(":").map(Number);
    const total = hour * 60 + minute + minutes;
    return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  function timeRangeLabel(value) {
    const time = normalizeTimeValue(value);
    return time ? `${time} - ${addMinutesToTime(time, 60)}` : "-";
  }

  function normalizeLessonDay(value) {
    const input = String(value || "").trim().toLocaleLowerCase("tr-TR");
    return lessonDays.find((day) => day.toLocaleLowerCase("tr-TR") === input) || "";
  }

  function ageGroupFromBirthYear(value) {
    const birthYear = Number(value);
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(birthYear) || birthYear < 1930 || birthYear > currentYear) return "";
    const age = currentYear - birthYear;
    if (age >= 18) return "Yetişkin";
    if (age >= 16) return "16+ Yaş";
    if (age >= 13) return "13-15 Yaş";
    if (age >= 10) return "10-12 Yaş";
    if (age >= 7) return "7-9 Yaş";
    if (age >= 4) return "4-6 Yaş";
    return "4-6 Yaş";
  }

  function populateLessonControls() {
    const dayOptions = lessonDays.map((day) => `<option value="${escapeHtml(day)}">${day ? escapeHtml(day) : "Gün seçin"}</option>`).join("");
    const timeOptions = [`<option value="">Saat seçin</option>`, ...lessonTimes.map((time) => `<option value="${time}">${time}</option>`)].join("");
    for (let index = 1; index <= 4; index += 1) {
      const daySelect = $(`#lessonDay${index}`);
      const timeSelect = $(`#lessonTime${index}`);
      if (daySelect) daySelect.innerHTML = dayOptions;
      if (timeSelect) timeSelect.innerHTML = timeOptions;
    }
  }

  function updateAgeGroupFromBirthYear(showWarning = false) {
    const birthYearInput = $("#studentBirthYear");
    const ageGroupInput = $("#studentAgeGroup");
    if (!birthYearInput || !ageGroupInput) return;
    if (!birthYearInput.value) return;
    const group = ageGroupFromBirthYear(birthYearInput.value);
    if (!group) {
      if (showWarning) setNotice("Geçerli bir doğum yılı giriniz.", true);
      return;
    }
    ageGroupInput.value = group;
  }

  function todayName() {
    return new Intl.DateTimeFormat("tr-TR", { weekday: "long" }).format(new Date());
  }

  function recordNo(student) {
    if (student.registrationNo) return student.registrationNo;
    const fallbackSlug = String(state.settings?.name || "").toLocaleLowerCase("tr-TR").includes("emba") ? "emba" : "kulup";
    const prefix = String(state.selectedClub?.slug || student.clubSlug || fallbackSlug).toLocaleLowerCase("tr-TR");
    return `${prefix}-${student.id || 0}`;
  }

  function normalizedRole() {
    return state.user?.normalizedRole || state.user?.role || "";
  }

  function isSuperAdmin() {
    return normalizedRole() === "super_admin";
  }

  function isCoach() {
    return normalizedRole() === "coach";
  }

  function canResetAttendanceSession() {
    const role = normalizedRole();
    return role === "manager" || role === "super_admin";
  }

  function hasSelectedClub() {
    return !isSuperAdmin() || Boolean(state.selectedClub?.id);
  }

  function homeViewForRole() {
    if (isSuperAdmin() && !state.selectedClub) return "superAdminView";
    return "dashboardView";
  }

  function can(permission) {
    return state.user?.permissions?.includes(permission);
  }

  function saveAppSessionState(viewId = state.activeView) {
    if (!state.user) return;
    sessionStorage.setItem(sessionKeys.appActive, "true");
    sessionStorage.setItem(sessionKeys.activeView, viewId || homeViewForRole());
    if (state.selectedClub?.id) {
      sessionStorage.setItem(sessionKeys.selectedClub, JSON.stringify(state.selectedClub));
    } else {
      sessionStorage.removeItem(sessionKeys.selectedClub);
    }
  }

  function clearAppSessionState() {
    Object.values(sessionKeys).forEach((key) => sessionStorage.removeItem(key));
  }

  function shouldRestoreAppSession() {
    return sessionStorage.getItem(sessionKeys.appActive) === "true";
  }

  function storedActiveView() {
    const value = sessionStorage.getItem(sessionKeys.activeView);
    return value && viewMeta[value] ? value : homeViewForRole();
  }

  function storedSelectedClub() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(sessionKeys.selectedClub) || "null");
      return parsed?.id ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  function currentClubName() {
    if (isSuperAdmin()) return state.selectedClub?.name || "";
    return state.user?.clubName || state.settings?.name || "EMBA Spor Kulübü";
  }

  function initials(value) {
    const parts = String(value || "Kulüp Asistanı").trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("tr-TR") || "KA";
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
    const normalized = String(role || "viewer").replace("_", "-");
    const badgeClass = {
      "super-admin": "badge-admin",
      admin: "badge-admin",
      manager: "badge-admin",
      coordinator: "badge-koordinator",
      koordinator: "badge-koordinator",
      assistant: "badge-koordinator",
      coach: "badge-antrenor",
      antrenor: "badge-antrenor",
      viewer: "badge-izleyici",
      izleyici: "badge-izleyici"
    }[normalized] || "badge-izleyici";
    return `<span class="role-badge role-${escapeHtml(normalized)} ${badgeClass}">${escapeHtml(label || role || "viewer")}</span>`;
  }

  function isEmbaClubName(value) {
    return String(value || "").toLocaleLowerCase("tr-TR").includes("emba");
  }

  function userClubName(user) {
    return user?.clubName || (user?.clubId ? `Kulüp #${user.clubId}` : "Kulüp Asistanı Merkez");
  }

  function userDisplayLine(user) {
    const role = user?.roleLabel || user?.normalizedRole || user?.role || "";
    return [user?.fullName || user?.username || "-", role, userClubName(user)].filter(Boolean).join(" | ");
  }

  function userDateLabel(user) {
    return dateLabel(user?.updatedAt || user?.updated_at || user?.createdAt || user?.created_at);
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
    return `<tr class="empty-row"><td data-label="Bilgi" colspan="${cols}">${emptyState(title, text)}</td></tr>`;
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

  function shouldScopeClub(url) {
    if (!isSuperAdmin() || !state.selectedClub?.id) return false;
    return [
      "/api/settings",
      "/api/dashboard",
      "/api/students",
      "/api/payments",
      "/api/attendance",
      "/api/import",
      "/api/audit-logs",
      "/api/backups"
    ].some((prefix) => url.startsWith(prefix));
  }

  function withClubQuery(url) {
    if (!shouldScopeClub(url)) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}clubId=${encodeURIComponent(state.selectedClub.id)}`;
  }

  function withClubBody(options) {
    if (!isSuperAdmin() || !state.selectedClub?.id || !options.body) return options;
    if (options.body instanceof FormData) return options;
    try {
      const parsed = JSON.parse(options.body);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          ...options,
          body: JSON.stringify({ ...parsed, clubId: state.selectedClub.id })
        };
      }
    } catch (_error) {
      return options;
    }
    return options;
  }

  async function api(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const scopedOptions = method === "GET" ? options : withClubBody(options);
    const isFormData = scopedOptions.body instanceof FormData;
    const response = await fetch(withClubQuery(url), {
      credentials: "include",
      headers: isFormData
        ? { ...(scopedOptions.headers || {}) }
        : {
          "Content-Type": "application/json",
          ...(scopedOptions.headers || {})
        },
      ...scopedOptions
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

  function expandSearch(input) {
    const box = input?.closest(".expanding-search, .search-box, .attendance-toolbar");
    if (!input || !box) return;
    box.classList.add("search-expanded");
    window.setTimeout(() => input.focus(), 20);
  }

  function collapseSearch(input) {
    const box = input?.closest(".expanding-search, .search-box, .attendance-toolbar");
    if (!input || !box || box.contains(document.activeElement)) return;
    box.classList.remove("search-expanded");
  }

  function setupExpandingSearch(input) {
    const box = input?.closest(".expanding-search, .search-box, .attendance-toolbar");
    if (!input || !box || box.dataset.expandingReady === "true") return;
    box.dataset.expandingReady = "true";
    const openFromPointer = (event) => {
      if (event.target !== input && window.matchMedia("(max-width: 768px)").matches) {
        event.preventDefault();
        event.stopPropagation();
        console.log("Arama tiklandi");
        expandSearch(input);
      }
    };
    box.addEventListener("click", openFromPointer);
    box.addEventListener("touchstart", openFromPointer, { passive: false });
    input.addEventListener("focus", () => box.classList.add("search-expanded"));
    input.addEventListener("blur", () => {
      window.setTimeout(() => collapseSearch(input), 120);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        input.blur();
      }
    });
  }

  function setupExpandingSearchFallbacks() {
    ["#globalSearch", "#paymentSearch", "#userSearch", "#attendanceCardSearch"].forEach((selector) => {
      const input = document.querySelector(selector);
      const box = input?.closest(".expanding-search, .search-box, .attendance-toolbar");
      if (!input || !box || box.dataset.expandingFallbackReady === "true") return;
      box.dataset.expandingFallbackReady = "true";
      const open = (event) => {
        if (!window.matchMedia("(max-width: 768px)").matches) return;
        if (event.target === input) return;
        event.preventDefault();
        event.stopPropagation();
        console.log("Arama tiklandi");
        expandSearch(input);
      };
      document.querySelector(selector)?.closest(".expanding-search, .search-box, .attendance-toolbar")?.addEventListener("click", open);
      document.querySelector(selector)?.closest(".expanding-search, .search-box, .attendance-toolbar")?.addEventListener("touchstart", open, { passive: false });
    });
  }

  function openMobileMenu() {
    document.body.classList.add("sidebar-open");
    if (els.sidebarOverlay) els.sidebarOverlay.hidden = false;
  }

  function showLogin(clearSessionTrace = true) {
    if (clearSessionTrace) clearAppSessionState();
    state.user = null;
    state.selectedClub = null;
    state.clubs = [];
    state.students = [];
    state.payments = [];
    state.attendance = [];
    state.lessonAttendance = [];
    state.attendanceReport = [];
    closeMobileMenu();
    document.body.classList.remove("auth-loading");
    els.loginView.classList.remove("hidden");
    els.appShell.classList.add("hidden");
    els.continueSessionButton?.classList.toggle("hidden", !state.user);
  }

  function showLoginWithExistingSession(user) {
    state.user = user;
    closeMobileMenu();
    document.body.classList.remove("auth-loading");
    els.loginView.classList.remove("hidden");
    els.appShell.classList.add("hidden");
    els.continueSessionButton?.classList.remove("hidden");
    if (els.loginMessage) {
      els.loginMessage.textContent = "Mevcut oturum bulundu. Devam etmek için butona basın.";
      els.loginMessage.classList.remove("error");
    }
  }

  async function continueExistingSession() {
    let user = state.user;
    if (!user) {
      const data = await api("/api/auth/me");
      user = data.user;
      state.user = user;
    }
    await enterAuthenticatedApp(shouldRestoreAppSession() ? storedActiveView() : homeViewForRole());
  }

  async function enterAuthenticatedApp(targetView = null) {
    showApp();
    if (isSuperAdmin()) {
      if (!state.clubs.length) await loadClubs();
      const savedClub = storedSelectedClub();
      if (savedClub) {
        state.selectedClub = state.clubs.find((club) => String(club.id) === String(savedClub.id)) || savedClub;
        updateClubContext();
        applyPermissions();
        await loadSettings();
        await loadStudents();
      }
      switchView(targetView || homeViewForRole());
    } else {
      if (!isCoach()) await loadSettings();
      await loadStudents();
      switchView(targetView || homeViewForRole());
    }
  }

  function updateRoleMenuLabels() {
    const role = normalizedRole();
    const dashboardButton = $('[data-view="dashboardView"] span');
    const studentsButton = $('[data-view="studentsView"] span');
    const attendanceButton = $('[data-view="attendanceView"] span');
    const superButton = $('[data-view="superAdminView"] span');
    if (superButton) superButton.textContent = "Otomasyon Yönetimi";
    if (role === "coach") {
      if (dashboardButton) dashboardButton.textContent = "Sayfam";
      if (studentsButton) studentsButton.textContent = "Öğrencilerim";
      if (attendanceButton) attendanceButton.textContent = "Yoklama Al";
      if (els.newStudentButton) els.newStudentButton.textContent = "Yeni Öğrenci Ekle";
    } else if (role === "coordinator") {
      if (dashboardButton) dashboardButton.textContent = "Operasyon";
      if (studentsButton) studentsButton.textContent = "Öğrenciler";
      if (els.newStudentButton) els.newStudentButton.textContent = "Yeni Kayıt";
    } else {
      if (dashboardButton) dashboardButton.textContent = "Kulüp Paneli";
      if (studentsButton) studentsButton.textContent = "Öğrenciler";
      if (attendanceButton) attendanceButton.textContent = "Yoklama Al";
      if (els.newStudentButton) els.newStudentButton.textContent = "Yeni Kayıt";
    }
  }

  function updateClubContext() {
    const selectedName = currentClubName();
    const showClubContext = Boolean(selectedName);
    els.clubContextLabel.classList.toggle("hidden", !showClubContext);
    els.clubContextLabel.textContent = showClubContext ? `${selectedName} yönetiliyor` : "";
    els.backToClubsButton.classList.toggle("hidden", !isSuperAdmin() || !state.selectedClub);
    if (els.dashboardClubName) els.dashboardClubName.textContent = selectedName || "EMBA Spor Kulübü";
    if (els.dashboardEyebrow) {
      els.dashboardEyebrow.textContent = isCoach() ? "Antrenör paneli" : (selectedName ? "EMBA Spor Kulübü" : "EMBA Spor Kulübü");
    }
    if (els.dashboardDescription) {
      els.dashboardDescription.textContent = isCoach()
        ? "Esra Mücahit Baturalp Akademi ders saatlerinizdeki yoklama ve öğrenci akışını takip edin."
        : "Esra Mücahit Baturalp Akademi öğrenci, yoklama ve tahsilat yönetimi.";
    }
    if (els.dashboardClubLogo) {
      const isEmba = String(state.selectedClub?.slug || "").toLowerCase() === "emba" || (!isSuperAdmin() && currentClubName().toLocaleLowerCase("tr-TR").includes("emba"));
      const logo = state.selectedClub?.logoUrl || (isEmba ? "/assets/emba-logo.jpeg" : "");
      els.dashboardClubLogo.hidden = !logo;
      if (logo) els.dashboardClubLogo.src = logo;
      if (els.dashboardClubFallback) els.dashboardClubFallback.classList.toggle("hidden", Boolean(logo));
      if (els.dashboardClubFallback) els.dashboardClubFallback.textContent = logo ? initials(selectedName) : "Logo Yok";
    }
    if (els.topClubLogo) {
      const selectedSlug = String(state.selectedClub?.slug || "").toLowerCase();
      const isEmba = selectedSlug === "emba" || (!isSuperAdmin() && currentClubName().toLocaleLowerCase("tr-TR").includes("emba"));
      const logo = state.selectedClub?.logoUrl || (isEmba ? "/assets/emba-logo.jpeg" : "");
      els.topClubLogo.classList.toggle("hidden", !selectedName);
      if (els.topClubLogoImage) {
        els.topClubLogoImage.hidden = !logo;
        if (logo) els.topClubLogoImage.src = logo;
      }
      if (els.topClubLogoFallback) {
        els.topClubLogoFallback.textContent = logo ? initials(selectedName) : "Logo Yok";
        els.topClubLogoFallback.hidden = Boolean(logo);
      }
    }
  }

  function showApp() {
    els.loginView.classList.add("hidden");
    els.appShell.classList.remove("hidden");
    document.body.classList.remove("auth-loading");
    const clubText = currentClubName();
    const roleText = state.user.roleLabel || state.user.role || "";
    const nameText = state.user.fullName || "";
    const role = normalizedRole();
    const userLabel = isSuperAdmin()
      ? "Otomasyon Sorumlusu · Kulüp Asistanı Merkez"
      : (role === "manager" && isEmbaClubName(clubText))
        ? "MÜCAHİT ÜNAL · Kulüp Yetkilisi · EMBA Spor Kulübü"
        : [nameText, roleText, clubText].filter(Boolean).join(" · ");
    els.userBadge.innerHTML = `<strong>${escapeHtml(userLabel || `${roleText} · ${clubText || ""}`)}</strong>`;
    state.activeView = isSuperAdmin() ? "superAdminView" : "dashboardView";
    updateRoleMenuLabels();
    updateClubContext();
    applyPermissions();
  }

  function applyPermissions() {
    const superAdminMode = isSuperAdmin();
    const clubSelected = hasSelectedClub();
    $$("[data-permission]").forEach((element) => {
      const centerAllowed = element.dataset.view === "usersView";
      const operationalNav = element.classList.contains("nav-button") && superAdminMode && !clubSelected && !centerAllowed;
      element.classList.toggle("hidden", !can(element.dataset.permission) || operationalNav);
    });
    $$("[data-super-admin-only]").forEach((element) => {
      element.classList.toggle("hidden", !superAdminMode);
    });
    $$("[data-coach-only]").forEach((element) => {
      element.classList.toggle("hidden", !isCoach());
    });
    $$("[data-finance-section]").forEach((element) => {
      element.classList.toggle("hidden", isCoach());
    });
    $$("[data-requires]").forEach((element) => {
      element.classList.toggle("hidden", !can(element.dataset.requires));
    });
    if (els.studentStatusFilter) {
      if (isCoach()) {
        els.studentStatusFilter.value = "Aktif";
        els.studentStatusFilter.disabled = true;
      } else {
        els.studentStatusFilter.disabled = false;
      }
    }
    const activeButton = $(`.nav-button[data-view="${state.activeView}"]`);
    if (activeButton?.classList.contains("hidden")) {
      const firstVisible = $$(".nav-button").find((button) => !button.classList.contains("hidden"));
      if (firstVisible) switchView(firstVisible.dataset.view);
    }
  }

  function updatePageMeta(viewId) {
    let [title, subtitle] = viewMeta[viewId] || viewMeta.dashboardView;
    if (isCoach() && viewId === "dashboardView") {
      title = "Sayfam";
      subtitle = "Bugünkü dersler, hızlı yoklama ve son yoklama kayıtları.";
    }
    if (isCoach() && viewId === "studentsView") {
      title = "Öğrencilerim";
      subtitle = "Kulübünüzdeki aktif öğrencileri görüntüleyin ve yeni kayıt ekleyin.";
    }
    els.pageTitle.textContent = title;
    els.pageSubtitle.textContent = subtitle;
  }

  function switchView(viewId) {
    const centerAllowedView = viewId === "superAdminView" || viewId === "usersView";
    if (isSuperAdmin() && !state.selectedClub && !centerAllowedView) {
      setNotice("Önce üst yönetim panelinden bir kulüp seçin.", true);
      viewId = "superAdminView";
    }
    const openCreateStudent = viewId === "studentCreateView";
    if (openCreateStudent) viewId = "studentsView";
    state.activeView = viewId;
    updatePageMeta(viewId);
    updateClubContext();
    closeMobileMenu();
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
    $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));

    if (viewId === "superAdminView") loadClubs();
    if (viewId === "dashboardView") loadDashboard();
    if (viewId === "studentsView") loadStudents();
    if (viewId === "attendanceView") loadAttendance();
    if (viewId === "paymentsView") loadPayments();
    if (viewId === "importView") renderImportPreview();
    if (viewId === "usersView") loadUsers();
    if (viewId === "backupView") loadBackups();
    if (openCreateStudent) openStudentEditor();
    saveAppSessionState(viewId);
  }

  async function loadClubs() {
    if (!isSuperAdmin()) return;
    els.superAdminCards.innerHTML = emptyState("Veriler yükleniyor...", "Kulüp özetleri hazırlanıyor.");
    const data = await api("/api/clubs");
    state.clubs = data.clubs || [];
    renderSuperAdmin(data.totals || {});
  }

  function renderSuperAdmin(totals) {
    els.superAdminCards.innerHTML = [
      metricCard("Kulüp", totals.clubCount ?? state.clubs.length, "navy", "Sistemdeki kulüp"),
      metricCard("Aktif Kulüp", totals.activeClubCount ?? state.clubs.filter((club) => club.status === "active").length, "green", "Kullanımda"),
      metricCard("Toplam Öğrenci", totals.studentCount ?? 0, "gold", "Tüm kulüpler"),
      metricCard("Toplam Kullanıcı", totals.userCount ?? 0, "navy", "Tüm roller")
    ].join("");

    els.clubGrid.innerHTML = state.clubs.length
      ? state.clubs.map((club) => {
        const isEmba = String(club.slug || "").toLowerCase() === "emba";
        const logo = club.logoUrl || (isEmba ? "/assets/emba-logo.jpeg" : "");
        return `
          <article class="club-card ${isEmba ? "primary-club" : ""}">
            <div class="club-card-head">
              ${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(club.name)} logosu">` : `<span class="fallback-logo small">Logo Yok</span>`}
              <div>
                <strong>${escapeHtml(club.name)}</strong>
                <span>${escapeHtml(club.slug)} · ${escapeHtml(club.plan)}</span>
              </div>
            </div>
            <div class="club-card-stats">
              <div><span>Öğrenci</span><strong>${club.studentCount}</strong></div>
              <div><span>Aktif</span><strong>${club.activeStudentCount}</strong></div>
              <div><span>Kullanıcı</span><strong>${club.userCount}</strong></div>
            </div>
            <div class="form-actions">
              <button type="button" data-action="manage-club" data-id="${club.id}">Kulübü Yönet</button>
              <span class="badge ${club.status === "active" ? "good" : "warn"}">${escapeHtml(club.status)}</span>
            </div>
          </article>
        `;
      }).join("")
      : emptyState("Henüz kulüp bulunamadı.", "İlk kulüp olarak EMBA görünmelidir.");
  }

  async function selectClub(id) {
    const club = state.clubs.find((item) => String(item.id) === String(id));
    if (!club) {
      setNotice("Kulüp bulunamadı.", true);
      return;
    }
    state.selectedClub = club;
    state.students = [];
    state.payments = [];
    state.attendance = [];
    state.studentDetails = {};
    state.importPreview = null;
    state.openStudentId = null;
    updateClubContext();
    applyPermissions();
    await loadSettings();
    await loadStudents();
    switchView("dashboardView");
    setNotice(`${club.name} yönetiliyor.`);
  }

  function clearSelectedClub() {
    state.selectedClub = null;
    state.students = [];
    state.payments = [];
    state.attendance = [];
    state.studentDetails = {};
    state.importPreview = null;
    state.openStudentId = null;
    updateClubContext();
    applyPermissions();
    switchView("superAdminView");
  }

  function readClubForm() {
    const createUser = els.clubCreateUser.checked;
    return {
      name: $("#clubName").value.trim(),
      slug: $("#clubSlug").value.trim(),
      plan: $("#clubPlan").value,
      status: $("#clubStatus").value,
      phone: $("#clubPhone").value.trim(),
      email: $("#clubEmail").value.trim(),
      city: $("#clubCity").value.trim(),
      address: $("#clubAddress").value.trim(),
      createUser,
      user: createUser
        ? {
          username: $("#clubAdminUsername").value.trim(),
          fullName: $("#clubAdminFullName").value.trim(),
          role: $("#clubAdminRole").value,
          password: $("#clubAdminPassword").value,
          passwordConfirm: els.clubAdminPasswordConfirm?.value || ""
        }
        : null
    };
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

  function setPanelTitle(container, title, pill) {
    const panel = container?.closest(".panel");
    const heading = panel?.querySelector(".panel-head h3");
    const badge = panel?.querySelector(".panel-head .soft-pill");
    if (heading) heading.textContent = title;
    if (badge) badge.textContent = pill || "";
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

  function paymentStatusFromAmounts(monthlyFee, paidAmount) {
    const fee = Number(monthlyFee || 0);
    const paid = Number(paidAmount || 0);
    if (fee > 0 && paid >= fee) return "paid";
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
    if (isSuperAdmin() && !state.selectedClub) {
      switchView("superAdminView");
      return;
    }
    if (isCoach()) {
      await loadCoachDashboard();
      return;
    }
    setPanelTitle(els.recentStudents, "Son Eklenen Öğrenciler", "Kayıt");
    setPanelTitle(els.todayLessons, "Bugünkü Ders Saatleri", "Program");
    els.dashboardCards.innerHTML = emptyState("Veriler yükleniyor...", "Panel özeti hazırlanıyor.");
    const [dashboard, paymentData] = await Promise.all([
      api("/api/dashboard"),
      can("payments:read") ? api(`/api/payments?month=${encodeURIComponent(monthValue())}`) : Promise.resolve({ payments: [] })
    ]);
    if (paymentData.payments) state.payments = paymentData.payments;
    const totalAttendance = (dashboard.attendance || []).reduce((sum, item) => sum + Number(item.total || 0), 0);
    els.dashboardCards.innerHTML = [
      metricCard("Toplam Öğrenci", dashboard.students?.total ?? 0, "navy", `${currentClubName()} kayıtları`),
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

  async function loadCoachDashboard() {
    setPanelTitle(els.todayLessons, "Bugünkü Ders Saatleri", "Program");
    setPanelTitle(els.recentStudents, "Son Alınan Yoklamalar", "Yoklama");
    const date = new Date().toISOString().slice(0, 10);
    const [slotsData, reportData] = await Promise.all([
      api(`/api/attendance/slots?date=${encodeURIComponent(date)}`),
      api(`/api/attendance/report?dateFrom=${encodeURIComponent(date)}&dateTo=${encodeURIComponent(date)}`)
    ]);
    state.attendanceSlots = slotsData.slots || [];
    state.attendanceReport = reportData.attendance || [];
    const present = reportData.summary?.present || 0;
    const absent = reportData.summary?.absent || 0;
    const unmarkedSlots = state.attendanceSlots.reduce((sum, slot) => sum + Number(slot.studentCount || 0), 0);
    els.dashboardCards.innerHTML = [
      metricCard("Bugünkü Saat", state.attendanceSlots.length, "navy", slotsData.dayOfWeek || todayName()),
      metricCard("Geldi", present, "green", "Bugünkü yoklama"),
      metricCard("Gelmedi", absent, "red", "Bugünkü yoklama"),
      metricCard("Planlı Öğrenci", unmarkedSlots, "gold", "Saat grupları")
    ].join("");
    const quickActions = `
      <div class="coach-actions">
        <button type="button" data-action="go-student-create">Öğrenci Ekle</button>
        <button type="button" data-action="go-attendance">Yoklama Al</button>
      </div>
    `;
    els.todayLessons.innerHTML = state.attendanceSlots.length
      ? quickActions + state.attendanceSlots.map((slot) => `
          <div class="compact-item">
            <div><strong>${escapeHtml(slot.time || "-")}</strong><span>${slot.studentCount} öğrenci</span></div>
            <button class="small-button" data-action="open-attendance-slot" data-time="${escapeHtml(slot.time || "")}" type="button">Yoklama Al</button>
          </div>
        `).join("")
      : quickActions + emptyState("Bugün ders saati görünmüyor.", "Seçili tarihte aktif ders grubu bulunamadı.");
    els.attendanceSummary.innerHTML = [
      `<div class="status-row"><strong>Geldi</strong><span class="badge good">${present}</span></div>`,
      `<div class="status-row"><strong>Gelmedi</strong><span class="badge bad">${absent}</span></div>`
    ].join("");
    els.revenueChart.innerHTML = "";
    els.recentStudents.innerHTML = state.attendanceReport.length
      ? state.attendanceReport.slice(0, 6).map((item) => `
          <div class="compact-item">
            <div><strong>${escapeHtml(item.studentName)}</strong><span>${dateLabel(item.lessonDate)} · ${escapeHtml(item.startTime || "-")}</span></div>
            ${statusBadge(item.status)}
          </div>
        `).join("")
      : emptyState("Bugün henüz yoklama kaydı yok.", "Yoklama aldıkça son kayıtlar burada görünür.");
    els.paymentWaiting.innerHTML = "";
    applyPermissions();
  }

  function getTodayLessonCount() {
    const day = todayName().toLocaleLowerCase("tr-TR");
    return state.students.reduce((total, student) => (
      total + (student.lessons || []).filter((lesson) => String(lesson.day || "").toLocaleLowerCase("tr-TR") === day).length
    ), 0);
  }

  function currentStudentSearch() {
    return (els.globalSearch?.value || "").trim();
  }

  function runStudentSearch() {
    if (state.activeView !== "studentsView") {
      switchView("studentsView");
      return;
    }
    loadStudents();
  }

  function clearStudentSearch() {
    if (els.globalSearch) els.globalSearch.value = "";
    runStudentSearch();
  }

  async function loadStudents(options = {}) {
    if (!can("students:read")) return;
    if (isSuperAdmin() && !state.selectedClub) {
      switchView("superAdminView");
      return;
    }
    const q = options.q ?? currentStudentSearch();
    const status = options.status ?? (els.studentStatusFilter?.value || "Aktif");
    const activeOn = options.activeOn || "";
    const shouldRender = options.render !== false;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status && status !== "all") params.set("status", status);
    if (activeOn) params.set("activeOn", activeOn);
    if (shouldRender) els.studentTable.innerHTML = emptyRow(8, "Veriler yükleniyor...", "Öğrenci listesi hazırlanıyor.");
    const data = await api(`/api/students?${params}`);
    state.students = data.students || [];
    if (shouldRender) renderStudents();
    fillStudentSelects();
    if (shouldRender && state.activeView === "dashboardView") {
      renderTodayLessons();
      renderRecentStudents();
      renderPaymentWaiting();
    }
  }

  function renderStudents() {
    els.studentCount.textContent = `${state.students.length} öğrenci listeleniyor`;
    if (!state.students.length) {
      const hasSearch = Boolean(currentStudentSearch());
      els.studentTable.innerHTML = hasSearch
        ? emptyRow(8, "Aramanıza uygun öğrenci bulunamadı.", "Arama metnini temizleyip tekrar deneyebilirsiniz.")
        : emptyRow(8, "Henüz öğrenci bulunamadı.", "Filtreyi temizleyebilir veya yeni kayıt ekleyebilirsiniz.");
      return;
    }
    els.studentTable.innerHTML = state.students.map((student) => {
      const detail = state.studentDetails[student.id];
      const detailRow = state.openStudentId === String(student.id) && detail ? renderStudentDetailRow(detail) : "";
      const actionRow = state.openStudentActionsId === String(student.id) ? renderStudentActionRow(student) : "";
      const editRow = state.editingStudentInlineId === String(student.id)
        ? `<tr class="student-inline-editor-row"><td data-label="Düzenleme" colspan="8"><div id="studentInlineEditorHost"></div></td></tr>`
        : "";
      return `
        <tr class="student-row">
          <td data-label="Kayıt No"><span class="record-code">${recordNo(student)}</span></td>
          <td data-label="Ad Soyad"><strong>${escapeHtml(student.fullName)}</strong><br><span class="muted">${escapeHtml(student.level || "-")}</span></td>
          <td data-label="Branş / Program">${escapeHtml(student.program || "-")}</td>
          <td data-label="Grup / Saat">${escapeHtml(lessonText(student) || "-")}</td>
          <td data-label="Veli">${escapeHtml(student.parentName || "-")}</td>
          <td data-label="Telefon">${escapeHtml(student.phone || "-")}</td>
          <td data-label="Durum">${statusBadge(student.status)}${student.passiveDate ? `<br><span class="muted">Pasif: ${dateLabel(student.passiveDate)}</span>` : ""}</td>
          <td data-label="İşlem">
            <button class="small-button secondary" data-action="toggle-student-actions" data-id="${student.id}" type="button">İşlemler</button>
          </td>
        </tr>
        ${actionRow}
        ${editRow}
        ${detailRow}
      `;
    }).join("");
    mountStudentInlineEditor();
  }

  function renderStudentActionRow(student) {
    const phoneLink = studentWhatsappLink(student);
    return `
      <tr class="student-action-panel-row">
        <td data-label="İşlem Paneli" colspan="8">
          <div class="student-action-panel">
            <button class="small-button secondary" data-action="detail-student" data-id="${student.id}" type="button">Öğrenciyi Gör</button>
            ${can("students:write") ? `<button class="small-button" data-action="edit-student" data-id="${student.id}" type="button">Düzenle</button>` : ""}
            ${can("payments:read") ? `<button class="small-button secondary" data-action="student-payment" data-id="${student.id}" type="button">Ödeme</button>` : ""}
            <button class="small-button secondary" data-action="student-attendance-detail" data-id="${student.id}" type="button">Yoklama/Detay</button>
            ${phoneLink ? `<a class="small-button whatsapp" href="${phoneLink}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
            ${can("students:delete") ? `<button class="small-button danger" data-action="delete-student" data-id="${student.id}" type="button">Pasife Al</button>` : ""}
          </div>
        </td>
      </tr>
    `;
  }

  function studentWhatsappLink(student) {
    const phone = normalizePhoneForWhatsapp(student?.phone);
    if (!phone) return "";
    const message = `Merhaba, ${student?.fullName || "öğrencimiz"} için bilgi almak istiyorum.`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  }

  function renderStudentDetailRow(data) {
    const student = data.student;
    const paymentTotal = (data.payments || []).reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
    const summary = data.attendanceSummary || {};
    const financeDetail = can("payments:read")
      ? `
        <div><span>Aylık Ücret</span><strong>${money(student.monthlyFee)}</strong></div>
        <div><span>Toplam Tahsilat</span><strong>${money(paymentTotal)}</strong></div>
      `
      : "";
    const financeStack = can("payments:read")
      ? ((data.payments || []).slice(0, 4).map((payment) => `
          <div class="status-row"><strong>${monthLabel(payment.periodMonth)}</strong><span>${money(payment.paidAmount)}</span></div>
        `).join("") || emptyState("Ödeme kaydı yok.", "Bu öğrenci için ödeme görünmüyor."))
      : "";
    const attendanceStack = `
      <div class="status-row"><strong>Toplam</strong><span class="badge">${summary.total || 0}</span></div>
      <div class="status-row"><strong>Geldi</strong><span class="badge good">${summary.present || 0}</span></div>
      <div class="status-row"><strong>Gelmedi</strong><span class="badge bad">${summary.absent || 0}</span></div>
      <div class="status-row"><strong>Devam</strong><span class="badge">${summary.attendanceRate || 0}%</span></div>
      ${(data.attendance || []).slice(0, 6).map((item) => `
        <div class="status-row">
          <strong>${dateLabel(item.lessonDate)} · ${escapeHtml(item.startTime || "-")}</strong>
          <span>${statusBadge(item.status)} ${escapeHtml(item.recordedByName || "")}</span>
        </div>
      `).join("") || emptyState("Yoklama kaydı yok.", "Yoklama alındıkça burada görünür.")}
    `;
    return `
      <tr class="student-detail-row">
        <td data-label="Öğrenci Detayı" colspan="8">
          <div class="inline-detail">
            <div>
              <h3>${escapeHtml(student.fullName)}</h3>
              <p>${recordNo(student)} · ${escapeHtml(student.program || "-")} · ${escapeHtml(student.level || "-")}</p>
            </div>
            <div class="detail-list">
              <div><span>Veli</span><strong>${escapeHtml(student.parentName || "-")}</strong></div>
              <div><span>Telefon</span><strong>${escapeHtml(student.phone || "-")}</strong></div>
              <div><span>Pasife alınma</span><strong>${student.passiveDate ? dateLabel(student.passiveDate) : "-"}</strong></div>
              ${financeDetail}
              <div><span>Dersler</span><strong>${escapeHtml(lessonText(student) || "-")}</strong></div>
            </div>
            <div class="status-stack">
              ${financeStack || attendanceStack}
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
    $("#studentBirthYear").value = "";
    $("#studentAgeGroup").value = "";
    $("#studentAlternatePhone").value = "";
    $("#studentRegistrationDate").value = new Date().toISOString().slice(0, 10);
    $("#studentPassiveDate").value = new Date().toISOString().slice(0, 10);
    $("#studentStatus").value = "Aktif";
    $("#studentProgram").value = "Yüzme";
    $("#studentLevel").value = "Başlangıç";
    $("#studentPackageCode").value = "GRUP-YUZME";
    $("#studentPackageName").value = "Grup Yüzme";
    $("#studentTotalSessions").value = "8";
    $("#studentSwimmingSessions").value = "8";
    $("#studentSportSessions").value = "0";
    $("#studentMonthlyFee").value = "6000";
    updatePassiveDateField();
  }

  function updatePassiveDateField() {
    const wrap = $("#studentPassiveDateWrap");
    const input = $("#studentPassiveDate");
    if (!wrap || !input) return;
    const passive = $("#studentStatus")?.value === "Pasif";
    wrap.classList.toggle("hidden", !passive);
    if (passive && !input.value) input.value = new Date().toISOString().slice(0, 10);
  }

  function mountStudentInlineEditor() {
    const host = $("#studentInlineEditorHost");
    if (host && els.studentEditor.parentElement !== host) {
      host.appendChild(els.studentEditor);
    }
  }

  function restoreStudentEditorHome() {
    if (studentEditorHome && els.studentEditor.parentElement !== studentEditorHome) {
      studentEditorHome.appendChild(els.studentEditor);
    }
  }

  function openStudentEditor(student, options = {}) {
    if (options.inline && student?.id) {
      state.editingStudentInlineId = String(student.id);
      renderStudents();
      mountStudentInlineEditor();
    } else {
      state.editingStudentInlineId = null;
      restoreStudentEditorHome();
    }
    clearStudentForm();
    els.studentEditor.classList.remove("hidden");
    if (!student) return;
    $("#studentId").value = student.id;
    $("#studentStatus").value = student.status;
    $("#studentFullName").value = student.fullName || "";
    $("#studentBirthYear").value = student.birthYear || "";
    $("#studentAgeGroup").value = student.ageGroup || ageGroupFromBirthYear(student.birthYear) || "";
    $("#studentProgram").value = student.program || "";
    $("#studentLevel").value = student.level || "Başlangıç";
    $("#studentPackageCode").value = student.packageCode || "";
    $("#studentPackageName").value = student.packageName || "";
    $("#studentParentName").value = student.parentName || "";
    $("#studentPhone").value = student.phone || "";
    $("#studentAlternatePhone").value = student.alternatePhone || "";
    $("#studentTotalSessions").value = student.monthlyTotalSessions || 0;
    $("#studentSwimmingSessions").value = student.monthlySwimmingSessions || 0;
    $("#studentSportSessions").value = student.monthlySportSessions || 0;
    $("#studentMonthlyFee").value = student.monthlyFee || 0;
    $("#studentRegistrationDate").value = String(student.registrationDate || "").slice(0, 10);
    $("#studentPassiveDate").value = dateInputValue(student.passiveDate) || new Date().toISOString().slice(0, 10);
    $("#studentSocial").value = student.socialMediaPermission ? "true" : "false";
    $("#studentNote").value = student.note || "";
    (student.lessons || []).slice(0, 4).forEach((lesson, index) => {
      $(`#lessonDay${index + 1}`).value = normalizeLessonDay(lesson.day);
      $(`#lessonTime${index + 1}`).value = normalizeTimeValue(lesson.time) || "";
    });
    updatePassiveDateField();
  }

  function readLessons() {
    const lessons = [];
    for (let index = 1; index <= 4; index += 1) {
      const day = normalizeLessonDay($(`#lessonDay${index}`).value);
      const time = normalizeTimeValue($(`#lessonTime${index}`).value);
      if (day && time) lessons.push({ day, time });
    }
    return lessons;
  }

  function readStudentForm() {
    const payload = {
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
      passiveDate: $("#studentStatus").value === "Pasif" ? $("#studentPassiveDate").value : null,
      note: $("#studentNote").value.trim(),
      lessons: readLessons()
    };
    if (isCoach()) {
      payload.packageCode = "";
      payload.packageName = "";
      payload.monthlyTotalSessions = 0;
      payload.monthlySwimmingSessions = 0;
      payload.monthlySportSessions = 0;
      payload.monthlyFee = 0;
    }
    return payload;
  }

  function studentPayloadFromExisting(student, status, passiveDate = null) {
    return {
      status,
      passiveDate: status === "Pasif" ? passiveDate : null,
      fullName: student.fullName || "",
      birthYear: student.birthYear || null,
      ageGroup: student.ageGroup || "",
      program: student.program || "Yüzme",
      level: student.level || "Başlangıç",
      packageCode: student.packageCode || "",
      packageName: student.packageName || "",
      parentName: student.parentName || "",
      phone: student.phone || "",
      alternatePhone: student.alternatePhone || "",
      socialMediaPermission: Boolean(student.socialMediaPermission),
      monthlyTotalSessions: Number(student.monthlyTotalSessions || 0),
      monthlySwimmingSessions: Number(student.monthlySwimmingSessions || 0),
      monthlySportSessions: Number(student.monthlySportSessions || 0),
      monthlyFee: Number(student.monthlyFee || 0),
      registrationDate: dateInputValue(student.registrationDate) || new Date().toISOString().slice(0, 10),
      note: student.note || "",
      lessons: (student.lessons || []).map((lesson) => ({
        day: normalizeLessonDay(lesson.day),
        time: normalizeTimeValue(lesson.time)
      })).filter((lesson) => lesson.day && lesson.time)
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
    if (isSuperAdmin() && !state.selectedClub) {
      switchView("superAdminView");
      return;
    }
    const date = els.attendanceDate.value || new Date().toISOString().slice(0, 10);
    els.attendanceDate.value = date;
    let slotsData;
    try {
      slotsData = await api(`/api/attendance/slots?date=${encodeURIComponent(date)}`);
    } catch (error) {
      state.attendanceSlots = [];
      state.lessonAttendance = [];
      els.attendanceSlotTime.innerHTML = `<option value="">Saat seçiniz</option>`;
      els.attendanceSlotTime.value = "";
      renderAttendanceTimeGrid();
      els.lessonAttendanceCards.innerHTML = emptyState("Saatler yüklenirken hata oluştu.", "Lütfen tarihi kontrol edip tekrar deneyin.");
      els.attendanceTable.innerHTML = emptyRow(6, "Saatler yüklenirken hata oluştu.", "Yoklama sayfasında kalıp tekrar deneyebilirsiniz.");
      setNotice("Saatler yüklenirken hata oluştu.", true);
      return;
    }
    state.attendanceSlots = slotsData.slots || [];
    const slotCounts = new Map(state.attendanceSlots.map((slot) => [normalizeTimeValue(slot.time), Number(slot.studentCount || 0)]));
    const firstActiveSlot = state.attendanceSlots.map((slot) => normalizeTimeValue(slot.time)).find(Boolean);
    const currentTime = normalizeTimeValue(state.pendingAttendanceTime || els.attendanceSlotTime.value) || firstActiveSlot || "";
    state.pendingAttendanceTime = null;
    els.attendanceSlotTime.innerHTML = [`<option value="">Saat seçiniz</option>`, ...lessonTimes
      .map((time) => {
        const count = slotCounts.get(time) || 0;
        const label = count ? `${time} · ${count} öğrenci` : time;
        return `<option value="${time}">${escapeHtml(label)}</option>`;
      })
    ].join("");
    if (currentTime && lessonTimes.includes(currentTime)) {
      els.attendanceSlotTime.value = currentTime;
    } else {
      els.attendanceSlotTime.value = "";
    }
    renderAttendanceTimeGrid();
    await loadLessonAttendance();
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
    await loadAttendanceReport();
  }

  function renderAttendanceTimeGrid() {
    if (!els.attendanceTimeGrid) return;
    const selected = normalizeTimeValue(els.attendanceSlotTime.value);
    const slotCounts = new Map(state.attendanceSlots.map((slot) => [normalizeTimeValue(slot.time), Number(slot.studentCount || 0)]));
    const selectedCount = selected ? (slotCounts.get(selected) || 0) : 0;
    if (els.attendanceSelectedTime) {
      els.attendanceSelectedTime.textContent = selected || "Saat seçiniz";
    }
    if (els.attendanceTimeSummary) {
      const filledSlots = state.attendanceSlots.filter((slot) => Number(slot.studentCount || 0) > 0).length;
      els.attendanceTimeSummary.textContent = selected
        ? `${selectedCount} öğrenci · başka saat seçmek için açın`
        : `${filledSlots} dolu saat · saat seçmek için açın`;
    }
    if (els.attendanceTimePanel) {
      els.attendanceTimePanel.classList.toggle("hidden", !state.attendanceTimesOpen);
    }
    if (els.attendanceTimeToggle) {
      els.attendanceTimeToggle.setAttribute("aria-expanded", state.attendanceTimesOpen ? "true" : "false");
      els.attendanceTimeToggle.classList.toggle("active", Boolean(selected));
    }
    els.attendanceTimeGrid.innerHTML = lessonTimes.map((time) => {
      const count = slotCounts.get(time) || 0;
      const activeClass = time === selected ? " active" : "";
      const emptyClass = count ? "" : " empty";
      return `<button class="time-chip${activeClass}${emptyClass}" data-action="select-attendance-time" data-time="${time}" type="button"><strong>${time}</strong><span>${count} öğrenci</span></button>`;
    }).join("");
    updateAttendanceClearButton();
  }

  function updateAttendanceClearButton() {
    if (!els.clearAttendanceButton) return;
    const hasTime = Boolean(normalizeTimeValue(els.attendanceSlotTime.value));
    els.clearAttendanceButton.classList.toggle("hidden", !canResetAttendanceSession() || !hasTime);
  }

  async function loadLessonAttendance() {
    const date = els.attendanceDate.value || new Date().toISOString().slice(0, 10);
    const time = normalizeTimeValue(els.attendanceSlotTime.value);
    renderAttendanceTimeGrid();
    if (!time) {
      state.lessonAttendance = [];
      state.attendanceListCollapsed = false;
      renderAttendanceCards();
      return;
    }
    let data;
    try {
      data = await api(`/api/attendance/lesson-students?date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}`);
      state.lessonAttendance = (data.students || []).map((student) => ({
        ...student,
        selectedStatus: student.attendanceStatus === "blank" ? null : (student.attendanceStatus || null)
      }));
    } catch (error) {
      state.lessonAttendance = [];
      els.lessonAttendanceCards.innerHTML = emptyState("Saatler yüklenirken hata oluştu.", "Seçili saate ait öğrenci listesi getirilemedi.");
      setNotice("Saatler yüklenirken hata oluştu.", true);
      return;
    }
    if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      console.info("Yoklama öğrenci listesi", { date, time, count: state.lessonAttendance.length });
    }
    renderAttendanceCards();
    renderManualAttendancePanel();
  }

  function renderManualAttendancePanel() {
    if (!els.manualAttendancePanel) return;
    const time = normalizeTimeValue(els.attendanceSlotTime.value);
    els.manualAttendancePanel.classList.toggle("hidden", !state.manualAttendanceOpen || !time);
    if (!state.manualAttendanceOpen || !time) return;
    if (!els.manualAttendanceResults) return;
    const search = (els.manualAttendanceSearch?.value || "").trim();
    if (search.length < 2) {
      els.manualAttendanceResults.innerHTML = emptyState("Öğrenci adı yazın.", "En az 2 karakter yazınca uygun öğrenciler listelenir.");
      return;
    }
    els.manualAttendanceResults.innerHTML = state.manualAttendanceResults.length
      ? state.manualAttendanceResults.map((student) => `
          <button class="manual-student-option" data-action="add-manual-attendance-student" data-id="${student.id}" type="button">
            <strong>${escapeHtml(student.fullName)}</strong>
            <span>${escapeHtml(student.parentName || "-")} · ${escapeHtml(student.phone || "-")}</span>
          </button>
        `).join("")
      : emptyState("Eklenebilir öğrenci bulunamadı.", "Ad soyad ile arama yapabilir veya farklı saat seçebilirsiniz.");
  }

  async function loadManualAttendanceCandidates() {
    const date = els.attendanceDate.value || new Date().toISOString().slice(0, 10);
    const time = normalizeTimeValue(els.attendanceSlotTime.value);
    const search = (els.manualAttendanceSearch?.value || "").trim();
    if (!time) {
      setNotice("Manuel öğrenci eklemek için önce saat seçin.", true);
      state.manualAttendanceOpen = false;
      renderManualAttendancePanel();
      return;
    }
    if (search.length < 2) {
      state.manualAttendanceResults = [];
      renderManualAttendancePanel();
      return;
    }
    const params = new URLSearchParams({ date, time });
    if (search) params.set("search", search);
    const data = await api(`/api/attendance/eligible-students?${params}`);
    state.manualAttendanceResults = data.students || [];
    renderManualAttendancePanel();
  }

  async function addManualAttendanceStudent(studentId) {
    const date = els.attendanceDate.value || new Date().toISOString().slice(0, 10);
    const time = normalizeTimeValue(els.attendanceSlotTime.value);
    await api("/api/attendance/manual-student", {
      method: "POST",
      body: JSON.stringify({ date, time, studentId })
    });
    if (els.manualAttendanceSearch) els.manualAttendanceSearch.value = "";
    state.manualAttendanceResults = [];
    await loadAttendance();
    state.manualAttendanceOpen = false;
    renderManualAttendancePanel();
    setNotice("Öğrenci seçili yoklama saatine eklendi.");
  }

  function renderAttendanceCards() {
    if (state.attendanceListCollapsed) {
      els.lessonAttendanceCards.innerHTML = emptyState("Yoklama kaydedildi.", "Listeyi tekrar açmak için seçili saate yeniden tıklayın.");
      if (els.attendanceUnmarkedCount) els.attendanceUnmarkedCount.textContent = "Liste kapalı";
      applyPermissions();
      return;
    }
    const search = (els.attendanceCardSearch?.value || "").trim().toLocaleLowerCase("tr-TR");
    const visibleStudents = search
      ? state.lessonAttendance.filter((student) => String(student.fullName || "").toLocaleLowerCase("tr-TR").includes(search))
      : state.lessonAttendance;
    const unmarked = state.lessonAttendance.filter((student) => !student.selectedStatus).length;
    if (els.attendanceUnmarkedCount) {
      els.attendanceUnmarkedCount.textContent = `${unmarked} işaretlenmedi`;
    }
    els.lessonAttendanceCards.innerHTML = visibleStudents.length
      ? visibleStudents.map((student) => {
        const firstLesson = (student.lessons || []).find((lesson) => normalizeTimeValue(lesson.time) === normalizeTimeValue(els.attendanceSlotTime.value)) || (student.lessons || [])[0] || {};
        return `
          <article class="attendance-card lesson-card">
            <div>
              <strong>${escapeHtml(student.fullName)}</strong>
              <span>${escapeHtml(firstLesson.day || "-")} · ${escapeHtml(firstLesson.time || els.attendanceSlotTime.value || "-")}</span>
              <span>${escapeHtml(student.parentName || "-")} · ${escapeHtml(student.phone || "-")}</span>
            </div>
            <div class="attendance-actions">
              <button class="attendance-status-button ${student.selectedStatus === "present" ? "selected present" : ""}" data-action="mark-attendance" data-id="${student.id}" data-status="present" type="button" aria-pressed="${student.selectedStatus === "present"}">Geldi</button>
              <button class="attendance-status-button ${student.selectedStatus === "absent" ? "selected absent" : ""}" data-action="mark-attendance" data-id="${student.id}" data-status="absent" type="button" aria-pressed="${student.selectedStatus === "absent"}">Gelmedi</button>
            </div>
          </article>
        `;
      }).join("")
      : emptyState("Bu tarih ve saatte aktif öğrenci bulunamadı.", "Tarih ve saat seçimini kontrol edin.");
    applyPermissions();
  }

  function markLessonAttendance(studentId, status) {
    state.lessonAttendance = state.lessonAttendance.map((student) => (
      String(student.id) === String(studentId) ? { ...student, selectedStatus: status } : student
    ));
    renderAttendanceCards();
  }

  async function saveLessonAttendance() {
    const unmarked = state.lessonAttendance.filter((student) => !student.selectedStatus).length;
    if (unmarked && !window.confirm(`${unmarked} öğrenci işaretlenmedi. Yine de kaydedilsin mi?`)) return;
    const records = state.lessonAttendance
      .filter((student) => student.selectedStatus)
      .map((student) => ({ studentId: student.id, status: student.selectedStatus }));
    if (!records.length) {
      setNotice("Kaydetmek için en az bir öğrenciyi işaretleyin.", true);
      return;
    }
    await api("/api/attendance/bulk", {
      method: "POST",
      body: JSON.stringify({
        lessonDate: els.attendanceDate.value,
        startTime: normalizeTimeValue(els.attendanceSlotTime.value),
        records
      })
    });
    state.attendanceListCollapsed = true;
    await loadAttendance();
  }

  async function loadAttendanceReport() {
    if (!can("attendance:read")) return;
    const todayValue = new Date().toISOString().slice(0, 10);
    els.reportDate.value = els.reportDate.value || todayValue;
    if (els.reportWeekStart) els.reportWeekStart.value = els.reportWeekStart.value || weekStartValue(els.reportDate.value);
    if (isSuperAdmin() && !state.clubs.length) await loadClubs();
    populateReportStaticFilters();
    const reportType = els.reportType?.value || "daily";
    els.reportWeekWrap?.classList.toggle("hidden", reportType !== "weekly");
    if (reportType === "weekly") {
      const start = weekStartValue(els.reportWeekStart?.value || els.reportDate.value);
      const end = addDaysValue(start, 6);
      if (els.reportWeekStart) els.reportWeekStart.value = start;
      const weeklyParams = new URLSearchParams({ start, end, status: els.reportStatus.value || "all" });
      if (els.reportCoach.value) weeklyParams.set("coachId", els.reportCoach.value);
      if (isSuperAdmin() && els.reportClub.value) weeklyParams.set("clubId", els.reportClub.value);
      try {
        const data = await api(`/api/reports/attendance-weekly?${weeklyParams}`);
        state.attendanceReportSessions = data.sessions || [];
        state.attendanceReport = [];
        populateReportDynamicFilters(data);
        renderWeeklyAttendanceReport(data);
      } catch (_error) {
        state.attendanceReportSessions = [];
        state.attendanceReportDetails = {};
        els.attendanceReportSummary.innerHTML = "";
        els.attendanceReportSessions.innerHTML = emptyState("Raporlar yüklenirken hata oluştu.", "Sayfada kalıp filtreleri değiştirerek tekrar deneyebilirsiniz.");
        setNotice("Raporlar yüklenirken hata oluştu.", true);
      }
      return;
    }
    const params = new URLSearchParams({
      date: els.reportDate.value,
      status: els.reportStatus.value || "all"
    });
    if (normalizeTimeValue(els.reportTime.value)) params.set("time", normalizeTimeValue(els.reportTime.value));
    if (els.reportCoach.value) params.set("coachId", els.reportCoach.value);
    if (isSuperAdmin() && els.reportClub.value) params.set("clubId", els.reportClub.value);
    try {
      const data = await api(`/api/reports/attendance-days?${params}`);
      state.attendanceReportSessions = data.sessions || [];
      state.attendanceReport = [];
      populateReportDynamicFilters(data);
      renderAttendanceReportSessions(data);
    } catch (error) {
      state.attendanceReportSessions = [];
      state.attendanceReportDetails = {};
      els.attendanceReportSummary.innerHTML = "";
      els.attendanceReportSessions.innerHTML = emptyState("Raporlar yüklenirken hata oluştu.", "Sayfada kalıp filtreleri değiştirerek tekrar deneyebilirsiniz.");
      setNotice("Raporlar yüklenirken hata oluştu.", true);
    }
  }

  function populateReportStaticFilters() {
    if (els.reportTime && els.reportTime.options.length <= 1) {
      const current = els.reportTime.value || "";
      els.reportTime.innerHTML = `<option value="">Tüm saatler</option>${lessonTimes.map((time) => `<option value="${time}">${time}</option>`).join("")}`;
      els.reportTime.value = current;
    }
    if (els.reportClubFilterWrap) {
      els.reportClubFilterWrap.classList.toggle("hidden", !isSuperAdmin());
    }
    if (isSuperAdmin() && els.reportClub) {
      const current = els.reportClub.value || (state.selectedClub?.id ? String(state.selectedClub.id) : "");
      els.reportClub.innerHTML = `<option value="">Tüm kulüpler</option>${state.clubs.map((club) => `<option value="${club.id}">${escapeHtml(club.name)}</option>`).join("")}`;
      els.reportClub.value = Array.from(els.reportClub.options).some((option) => option.value === current) ? current : "";
    }
  }

  function populateReportDynamicFilters(data) {
    if (!els.reportCoach) return;
    const current = els.reportCoach.value || "";
    const coaches = data.coaches || [];
    els.reportCoach.innerHTML = `<option value="">Tüm antrenörler</option>${coaches.map((coach) => (
      coach.id ? `<option value="${coach.id}">${escapeHtml(coach.name)}</option>` : ""
    )).join("")}`;
    els.reportCoach.value = Array.from(els.reportCoach.options).some((option) => option.value === current) ? current : "";
  }

  function renderAttendanceReportSessions(data = {}) {
    const sessions = state.attendanceReportSessions || [];
    const total = sessions.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const present = sessions.reduce((sum, item) => sum + Number(item.present || 0), 0);
    const absent = sessions.reduce((sum, item) => sum + Number(item.absent || 0), 0);
    const excused = sessions.reduce((sum, item) => sum + Number(item.excused || 0), 0);
    els.attendanceReportSummary.innerHTML = [
      metricCard("Toplam", total, "navy", "Öğrenci"),
      metricCard("Geldi", present, "green", "Katılım"),
      metricCard("Gelmedi", absent, "red", "Devamsızlık"),
      metricCard("Mazeretli", excused, "gold", "Mazeret")
    ].join("");
    const reportDate = els.reportDate.value || data.date || new Date().toISOString().slice(0, 10);
    const title = `${dateLabel(reportDate)} ${data.dayOfWeek || todayName()} Yoklamaları`;
    els.attendanceReportSessions.innerHTML = `
      <div class="attendance-report-title">
        <h3>${escapeHtml(title)}</h3>
      </div>
      ${sessions.length ? sessions.map(renderAttendanceReportSession).join("") : emptyState("Bu gün için saat bazlı yoklama bulunamadı.", "Tarih veya filtreleri değiştirerek tekrar deneyin.")}
    `;
  }

  function attendanceMark(status) {
    if (status === "present") return "+";
    if (status === "excused") return "M";
    if (status === "absent") return "-";
    return "";
  }

  function renderWeeklyAttendanceReport(data = {}) {
    const columns = data.columns || [];
    const rows = data.students || [];
    const totals = data.totals || {};
    els.attendanceReportSummary.innerHTML = [
      metricCard("Toplam", totals.total || 0, "navy", "Kayıt"),
      metricCard("Geldi", totals.present || 0, "green", "Katılım"),
      metricCard("Gelmedi", totals.absent || 0, "red", "Devamsızlık"),
      metricCard("Mazeretli", totals.excused || 0, "gold", "Mazeret")
    ].join("");
    if (!rows.length || !columns.length) {
      els.attendanceReportSessions.innerHTML = emptyState("Seçilen hafta için yoklama kaydı bulunamadı.", "Hafta başlangıcını veya filtreleri değiştirerek tekrar deneyin.");
      return;
    }
    els.attendanceReportSessions.innerHTML = `
      <div class="attendance-report-title">
        <h3>${escapeHtml(dateOnlyLabel(data.start))} - ${escapeHtml(dateOnlyLabel(data.end))} Haftalık Yoklama</h3>
      </div>
      <div class="weekly-report-scroll">
        <table class="weekly-report-table">
          <thead>
            <tr>
              <th>Öğrenci</th>
              ${columns.map((column) => `<th>${escapeHtml(dateOnlyLabel(column.date))}<br>${escapeHtml(column.time || "-")}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.map((student) => `
              <tr>
                <td data-label="Öğrenci"><strong>${escapeHtml(student.studentName || "-")}</strong></td>
                ${columns.map((column) => `<td data-label="${escapeHtml(`${dateOnlyLabel(column.date)} ${column.time || ""}`)}">${escapeHtml(attendanceMark(student.matrix?.[column.key]?.status))}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderAttendanceReportSession(session) {
    const detail = state.attendanceReportDetails[session.id];
    const isEditing = state.editingReportSessionId === session.id;
    const detailHtml = detail ? renderAttendanceReportDetail(session, detail, isEditing) : "";
    return `
      <article class="attendance-session-card">
        <button class="attendance-session-head" data-action="toggle-report-session" data-session-id="${escapeHtml(session.id)}" type="button">
          <div>
            <strong>${escapeHtml(timeRangeLabel(session.startTime))}</strong>
            <span>${escapeHtml(session.clubName || currentClubName() || "Kulüp Asistanı Merkez")}</span>
          </div>
          <div class="attendance-session-metrics">
            <span>Toplam <strong>${Number(session.total || 0)}</strong></span>
            <span>Geldi <strong>${Number(session.present || 0)}</strong></span>
            <span>Gelmedi <strong>${Number(session.absent || 0)}</strong></span>
            <span>Mazeretli <strong>${Number(session.excused || 0)}</strong></span>
          </div>
          <div class="attendance-session-meta">
            <span>${escapeHtml(session.recordedByName || "Yoklamayı alan yok")}</span>
            <small>${escapeHtml(dateLabel(session.recordedAt) || "-")}</small>
          </div>
        </button>
        ${detailHtml}
      </article>
    `;
  }

  function renderAttendanceReportDetail(session, detail, isEditing) {
    const rows = detail.records || [];
    const actions = detail.canEdit
      ? `<button class="small-button secondary" data-action="${isEditing ? "cancel-report-edit" : "edit-report-session"}" data-session-id="${escapeHtml(session.id)}" type="button">${isEditing ? "Vazgeç" : "Düzenle"}</button>
         ${isEditing ? `<button class="small-button" data-action="save-report-session" data-session-id="${escapeHtml(session.id)}" type="button">Değişiklikleri Kaydet</button>` : ""}`
      : `<span class="soft-pill">Düzenleme yetkiniz yok</span>`;
    const cancelInfo = detail.canCancel && !detail.cancellationMigrationRequired
      ? `<button class="small-button danger" data-action="cancel-attendance-session" data-session-id="${escapeHtml(session.id)}" type="button">Yoklamayı İptal Et</button>`
      : "";
    const resetInfo = detail.canReset && canResetAttendanceSession()
      ? `<button class="small-button danger" data-action="reset-attendance-session" data-session-id="${escapeHtml(session.id)}" type="button">Yoklamayı Temizle</button>`
      : "";
    return `
      <div class="attendance-session-detail">
        <div class="panel-head">
          <div>
            <h3>${escapeHtml(timeRangeLabel(session.startTime))} Detay</h3>
            <p>${rows.length} öğrenci listeleniyor</p>
          </div>
          <div class="actions report-detail-actions">${actions}${resetInfo}${cancelInfo}</div>
        </div>
        <div class="attendance-detail-list">
          ${rows.length ? rows.map((item) => `
            <div class="attendance-detail-row">
              <strong>${escapeHtml(item.studentName || "-")}</strong>
              ${isEditing ? `
                <select data-report-record="${item.id}">
                  <option value="present" ${item.status === "present" ? "selected" : ""}>Geldi</option>
                  <option value="absent" ${item.status === "absent" ? "selected" : ""}>Gelmedi</option>
                  <option value="excused" ${item.status === "excused" ? "selected" : ""}>Mazeretli</option>
                </select>
              ` : statusBadge(item.status)}
            </div>
          `).join("") : emptyState("Detay kaydı bulunamadı.", "Bu saat için rapor detayı yok.")}
        </div>
      </div>
    `;
  }

  async function toggleAttendanceReportSession(sessionId) {
    const session = state.attendanceReportSessions.find((item) => item.id === sessionId);
    if (!session) return;
    if (state.attendanceReportDetails[sessionId]) {
      delete state.attendanceReportDetails[sessionId];
      if (state.editingReportSessionId === sessionId) state.editingReportSessionId = null;
      renderAttendanceReportSessions();
      return;
    }
    await loadAttendanceReportDetail(session);
  }

  async function loadAttendanceReportDetail(session) {
    const params = new URLSearchParams({
      date: dateInputValue(session.lessonDate || els.reportDate.value),
      time: normalizeTimeValue(session.startTime),
      status: els.reportStatus.value || "all"
    });
    if (els.reportCoach.value) params.set("coachId", els.reportCoach.value);
    if (isSuperAdmin() && session.clubId) params.set("clubId", session.clubId);
    try {
      const data = await api(`/api/reports/attendance-detail?${params}`);
      state.attendanceReportDetails[session.id] = data;
      renderAttendanceReportSessions();
    } catch (error) {
      setNotice("Raporlar yüklenirken hata oluştu.", true);
    }
  }

  async function saveAttendanceReportSession(sessionId) {
    const detail = state.attendanceReportDetails[sessionId];
    if (!detail) return;
    const controls = $$(`[data-report-record]`);
    await Promise.all(controls.map((control) => api(`/api/reports/attendance-records/${control.dataset.reportRecord}`, {
      method: "PATCH",
      body: JSON.stringify({ status: control.value })
    })));
    state.editingReportSessionId = null;
    delete state.attendanceReportDetails[sessionId];
    await loadAttendanceReport();
    const session = state.attendanceReportSessions.find((item) => item.id === sessionId);
    if (session) await loadAttendanceReportDetail(session);
    setNotice("Yoklama raporu güncellendi.");
  }

  function dateOnlyLabel(value) {
    const input = dateInputValue(value);
    return input ? new Intl.DateTimeFormat("tr-TR").format(new Date(`${input}T12:00:00`)) : "-";
  }

  function dateTimeLabel(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(date);
  }

  function reportStatusText(status) {
    return statusLabels[status] || status || "-";
  }

  function validAttendanceCleanConfirm(value) {
    const normalized = String(value || "").trim().toLocaleUpperCase("tr-TR").replace(/İ/g, "I");
    return ["TEMIZLE", "SIFIRLA"].includes(normalized);
  }

  function attendanceClearClubId() {
    return isSuperAdmin() ? state.selectedClub?.id : state.user?.clubId;
  }

  function openAttendanceResetModal(sessionId) {
    const session = state.attendanceReportSessions.find((item) => String(item.id) === String(sessionId));
    if (!session || !canResetAttendanceSession()) return;
    state.pendingAttendanceResetSessionId = session.id;
    state.pendingAttendanceClearContext = {
      source: "report",
      date: dateInputValue(session.lessonDate || els.reportDate.value),
      time: normalizeTimeValue(session.startTime),
      clubId: session.clubId || attendanceClearClubId(),
      label: `${dateOnlyLabel(session.lessonDate || els.reportDate.value)} · ${timeRangeLabel(session.startTime)} · ${session.clubName || currentClubName() || "Kulüp Asistanı"}`
    };
    if (els.attendanceResetSessionLabel) {
      els.attendanceResetSessionLabel.textContent = state.pendingAttendanceClearContext.label;
    }
    if (els.attendanceResetConfirmInput) els.attendanceResetConfirmInput.value = "";
    els.attendanceResetModal?.classList.remove("hidden");
    window.setTimeout(() => els.attendanceResetConfirmInput?.focus(), 50);
  }

  function openSelectedAttendanceClearModal() {
    const date = els.attendanceDate.value || new Date().toISOString().slice(0, 10);
    const time = normalizeTimeValue(els.attendanceSlotTime.value);
    if (!time) {
      setNotice("Temizlemek için önce tarih ve saat seçin.", true);
      return;
    }
    if (!canResetAttendanceSession()) return;
    state.pendingAttendanceResetSessionId = null;
    state.pendingAttendanceClearContext = {
      source: "attendance",
      date,
      time,
      clubId: attendanceClearClubId(),
      label: `${dateOnlyLabel(date)} · ${timeRangeLabel(time)} · ${currentClubName() || "Kulüp Asistanı"}`
    };
    if (els.attendanceResetSessionLabel) els.attendanceResetSessionLabel.textContent = state.pendingAttendanceClearContext.label;
    if (els.attendanceResetConfirmInput) els.attendanceResetConfirmInput.value = "";
    els.attendanceResetModal?.classList.remove("hidden");
    window.setTimeout(() => els.attendanceResetConfirmInput?.focus(), 50);
  }

  function closeAttendanceResetModal() {
    state.pendingAttendanceResetSessionId = null;
    state.pendingAttendanceClearContext = null;
    if (els.attendanceResetConfirmInput) els.attendanceResetConfirmInput.value = "";
    els.attendanceResetModal?.classList.add("hidden");
  }

  async function confirmAttendanceReset() {
    const context = state.pendingAttendanceClearContext;
    const reportSessionId = state.pendingAttendanceResetSessionId;
    if (!context) {
      closeAttendanceResetModal();
      return;
    }
    if (!validAttendanceCleanConfirm(els.attendanceResetConfirmInput?.value)) {
      setNotice("İşlem için TEMIZLE yazmalısınız.", true);
      els.attendanceResetConfirmInput?.focus();
      return;
    }
    try {
      await api("/api/attendance/clear", {
        method: "POST",
        body: JSON.stringify({
          confirm: "TEMIZLE",
          date: context.date,
          time: context.time,
          clubId: context.clubId
        })
      });
      closeAttendanceResetModal();
      if (context.source === "report") {
        delete state.attendanceReportDetails[reportSessionId];
        if (state.editingReportSessionId === reportSessionId) state.editingReportSessionId = null;
        await loadAttendanceReport();
      } else {
        await loadAttendance();
      }
      setNotice("Seçilen yoklama temizlendi.");
    } catch (_error) {
      setNotice("Yoklama temizlenirken hata oluştu.", true);
    }
  }

  function renderPrintReport(data) {
    const sessions = data.sessions || [];
    const totals = data.totals || {};
    const clubNames = Array.from(new Set(sessions.map((session) => session.clubName).filter(Boolean)));
    const clubName = clubNames.length === 1
      ? clubNames[0]
      : (clubNames.length > 1 ? "Tüm Kulüpler" : (currentClubName() || "Kulüp Asistanı"));
    const attendanceRate = Number(totals.attendanceRate || 0);
    const rows = sessions.flatMap((session) => (session.records || []).map((record) => ({
      ...record,
      date: session.lessonDate || data.date,
      time: normalizeTimeValue(session.startTime),
      coach: record.recordedByName || session.recordedByName || "-"
    }))).sort((first, second) => (
      String(first.time || "").localeCompare(String(second.time || "")) ||
      String(first.studentName || "").localeCompare(String(second.studentName || ""), "tr")
    ));
    els.printReport.innerHTML = `
      <div class="print-report-page print-attendance-report">
        <header class="print-report-header">
          <div class="print-report-brand">
            <p>Kulüp Asistanı</p>
            <h1>KULÜP ASİSTANI YOKLAMA RAPORU</h1>
            <strong>${escapeHtml(clubName)}</strong>
          </div>
          <div class="print-report-meta">
            <span><strong>Rapor tarihi</strong>${escapeHtml(dateOnlyLabel(data.date))}</span>
            <span><strong>Gün</strong>${escapeHtml(data.dayOfWeek || "-")}</span>
            <span><strong>Hazırlanma</strong>${escapeHtml(dateTimeLabel(data.preparedAt))}</span>
            <span><strong>Toplam</strong>${Number(totals.total || 0)} kayıt · %${attendanceRate} devam</span>
          </div>
        </header>
        <div class="print-legend">
          <span><strong>+</strong> Geldi</span>
          <span><strong>-</strong> Gelmedi</span>
          <span><strong>M</strong> Mazeretli</span>
        </div>
        <table class="print-attendance-matrix print-daily-table">
          <thead>
            <tr>
              <th>Sıra</th>
              <th>Öğrenci Adı Soyadı</th>
              <th>Tarih</th>
              <th>Saat</th>
              <th>Durum</th>
              <th>Antrenör</th>
              <th>Not</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((record, index) => `
              <tr>
                <td data-label="Sıra">${index + 1}</td>
                <td data-label="Öğrenci Adı Soyadı">${escapeHtml(record.studentName || "-")}</td>
                <td data-label="Tarih">${escapeHtml(dateOnlyLabel(record.date))}</td>
                <td data-label="Saat">${escapeHtml(record.time || "-")}</td>
                <td data-label="Durum">${escapeHtml(attendanceMark(record.status) || "-")}</td>
                <td data-label="Antrenör">${escapeHtml(record.coach || "-")}</td>
                <td data-label="Not">${escapeHtml(record.note || "")}</td>
              </tr>
            `).join("") : `<tr><td data-label="Bilgi" colspan="7">Seçilen güne ait yoklama kaydı bulunamadı.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderWeeklyPrintReport(data) {
    const columns = data.columns || [];
    const rows = data.students || [];
    const totals = data.totals || {};
    const chunkSize = 6;
    const chunks = [];
    for (let index = 0; index < columns.length; index += chunkSize) {
      chunks.push(columns.slice(index, index + chunkSize));
    }
    const shortColumnLabel = (column) => {
      const date = dateInputValue(column.date);
      const [, month, day] = date.split("-");
      return `${day}.${month}<br>${escapeHtml(column.time || "-")}`;
    };
    const renderChunkTable = (chunk, index) => `
      <section class="print-weekly-section">
        <div class="print-weekly-title">Haftalık Yoklama ${chunks.length > 1 ? `(${index + 1}/${chunks.length})` : ""}</div>
        <table class="print-attendance-matrix print-weekly-table">
          <thead>
            <tr>
              <th>Öğrenci Adı Soyadı</th>
              ${chunk.map((column) => `<th>${shortColumnLabel(column)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((student) => `
              <tr>
                <td data-label="Öğrenci">${escapeHtml(student.studentName || "-")}</td>
                ${chunk.map((column) => `<td data-label="${escapeHtml(column.key)}">${escapeHtml(attendanceMark(student.matrix?.[column.key]?.status))}</td>`).join("")}
              </tr>
            `).join("") : `<tr><td data-label="Bilgi" colspan="${Math.max(chunk.length + 1, 2)}">Seçilen hafta için yoklama kaydı bulunamadı.</td></tr>`}
          </tbody>
        </table>
      </section>
    `;
    const weeklyTables = rows.length && chunks.length ? chunks.map(renderChunkTable).join("") : `
      <p class="print-empty-message">Seçilen hafta için yoklama kaydı bulunamadı.</p>
    `;
    els.printReport.innerHTML = `
      <div class="print-report-page print-attendance-report">
        <header class="print-report-header">
          <div class="print-report-brand">
            <p>Kulüp Asistanı</p>
            <h1>HAFTALIK YOKLAMA RAPORU</h1>
            <strong>${escapeHtml(currentClubName() || "EMBA Spor Kulübü")}</strong>
          </div>
          <div class="print-report-meta">
            <span><strong>Hafta</strong>${escapeHtml(dateOnlyLabel(data.start))} - ${escapeHtml(dateOnlyLabel(data.end))}</span>
            <span><strong>Hazırlanma</strong>${escapeHtml(dateTimeLabel(data.preparedAt))}</span>
            <span><strong>Toplam</strong>${Number(totals.total || 0)} kayıt</span>
            <span><strong>Devam</strong>${Number(totals.present || 0)} geldi</span>
          </div>
        </header>
        <div class="print-legend"><span><strong>+</strong> Geldi</span><span><strong>-</strong> Gelmedi</span><span><strong>M</strong> Mazeretli</span></div>
        ${weeklyTables}
      </div>
    `;
  }

  function hasPrintableAttendanceReport() {
    if (!els.printReport) return false;
    const table = els.printReport.querySelector("table");
    const rows = els.printReport.querySelectorAll("tbody tr");
    return Boolean(table && rows.length);
  }

  async function printRenderedAttendanceReport() {
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    if (!hasPrintableAttendanceReport()) {
      if (els.printReport) els.printReport.innerHTML = "";
      setNotice("Yazdırılacak rapor verisi bulunamadı.", true);
      return;
    }
    window.print();
    setNotice("");
  }

  async function printAttendanceReport() {
    if (els.printReport) els.printReport.innerHTML = "";
    const reportType = els.reportType?.value || "daily";
    if (reportType === "weekly") {
      const start = weekStartValue(els.reportWeekStart?.value || els.reportDate.value || new Date().toISOString().slice(0, 10));
      const end = addDaysValue(start, 6);
      const weeklyParams = new URLSearchParams({ start, end, status: els.reportStatus.value || "all" });
      if (els.reportCoach.value) weeklyParams.set("coachId", els.reportCoach.value);
      if (isSuperAdmin() && els.reportClub.value) weeklyParams.set("clubId", els.reportClub.value);
      try {
        setNotice("Haftalık rapor çıktısı hazırlanıyor...");
        const data = await api(`/api/reports/attendance-weekly?${weeklyParams}`);
        if (!(data.students || []).length || !(data.columns || []).length) {
          if (els.printReport) els.printReport.innerHTML = "";
          setNotice("Yazdırılacak rapor verisi bulunamadı.", true);
          return;
        }
        renderWeeklyPrintReport(data);
        await printRenderedAttendanceReport();
      } catch (_error) {
        setNotice("Rapor çıktısı hazırlanırken hata oluştu.", true);
      }
      return;
    }
    const reportDate = els.reportDate.value || new Date().toISOString().slice(0, 10);
    els.reportDate.value = reportDate;
    const params = new URLSearchParams({ date: reportDate });
    if (isSuperAdmin() && els.reportClub.value) params.set("clubId", els.reportClub.value);
    try {
      setNotice("Rapor çıktısı hazırlanıyor...");
      const data = await api(`/api/reports/attendance-print?${params}`);
      const printableRows = (data.sessions || []).reduce((sum, session) => sum + ((session.records || []).length), 0);
      if (!printableRows) {
        if (els.printReport) els.printReport.innerHTML = "";
        setNotice("Yazdırılacak rapor verisi bulunamadı.", true);
        return;
      }
      renderPrintReport(data);
      await printRenderedAttendanceReport();
    } catch (_error) {
      setNotice("Rapor çıktısı hazırlanırken hata oluştu.", true);
    }
  }

  function buildPaymentRows() {
    const month = els.paymentMonthFilter.value || monthValue();
    const activeStudents = state.students.filter((student) => studentEligibleForMonth(student, month));
    const byStudent = new Map(activeStudents.map((student) => [String(student.id), student]));
    const rows = state.payments.filter((payment) => byStudent.has(String(payment.studentId))).map((payment) => {
      const student = byStudent.get(String(payment.studentId)) || {};
      return {
        ...payment,
        phone: student.phone || "",
        parentName: student.parentName || "",
        program: student.program || ""
      };
    });
    const seen = new Set(rows.map((payment) => String(payment.studentId)));
    for (const student of activeStudents) {
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

  function paymentRowKey(payment) {
    return payment?.id ? `payment-${payment.id}` : `student-${payment?.studentId || "new"}`;
  }

  function paymentInlineStatusOptions(status) {
    return [
      ["partial", "Kısmi"],
      ["paid", "Ödendi"],
      ["unpaid", "Ödenmedi"]
    ].map(([value, label]) => `<option value="${value}" ${status === value ? "selected" : ""}>${label}</option>`).join("");
  }

  function renderPaymentEditRow(payment, rowKey) {
    const status = paymentStatus(payment);
    return `
      <tr class="payment-edit-row">
        <td data-label="Ödeme Düzenleme" colspan="9">
          <form class="payment-inline-editor" data-payment-edit-form data-row-key="${escapeHtml(rowKey)}" data-payment-id="${escapeHtml(payment.id || "")}" data-student-id="${escapeHtml(payment.studentId || "")}">
            <div class="inline-editor-head">
              <div>
                <strong>${escapeHtml(payment.studentName || "-")}</strong>
                <span>${payment.id ? "Ödeme kaydı düzenleniyor" : "Bu öğrenci için yeni ödeme kaydı oluşturulacak"}</span>
              </div>
              <span class="soft-pill">${escapeHtml(monthLabel(payment.periodMonth))}</span>
            </div>
            <div class="payment-inline-grid">
              <label>Aylık ücret<input name="monthlyFee" type="number" min="0" value="${escapeHtml(Number(payment.monthlyFee || 0))}" required></label>
              <label>Ödenen tutar<input name="paidAmount" type="number" min="0" value="${escapeHtml(Number(payment.paidAmount || 0))}" required></label>
              <label>Ödeme durumu<select name="status" data-payment-inline-status>${paymentInlineStatusOptions(status)}</select></label>
              <label>Ay / dönem<input name="periodMonth" type="month" value="${escapeHtml(monthInputValue(payment.periodMonth))}" required></label>
              <label>Ödeme tarihi<input name="paymentDate" type="date" value="${escapeHtml(dateInputValue(payment.paymentDate) || new Date().toISOString().slice(0, 10))}"></label>
              <label>Ödeme yöntemi<input name="method" value="${escapeHtml(payment.method || "")}" placeholder="Nakit / Havale"></label>
              <label class="span-2">Açıklama / not<input name="description" value="${escapeHtml(payment.description || "")}"></label>
            </div>
            <div class="form-message payment-inline-message" data-payment-inline-message></div>
            <div class="actions payment-inline-actions">
              <button type="submit">${payment.id ? "Değişiklikleri Kaydet" : "Ödemeyi Kaydet"}</button>
              <button class="secondary" data-action="cancel-payment-inline" type="button">Vazgeç</button>
            </div>
          </form>
        </td>
      </tr>
    `;
  }

  function paymentPayloadFromInlineForm(form) {
    const payload = {
      periodMonth: form.elements.periodMonth.value,
      monthlyFee: form.elements.monthlyFee.value,
      paidAmount: form.elements.paidAmount.value,
      status: form.elements.status.value,
      paymentDate: form.elements.paymentDate.value,
      method: form.elements.method.value.trim(),
      description: form.elements.description.value.trim()
    };
    if (!form.dataset.paymentId) payload.studentId = form.dataset.studentId;
    return payload;
  }

  function syncInlinePaymentAmount(form) {
    const status = form.elements.status.value;
    const monthlyFee = Number(form.elements.monthlyFee.value || 0);
    if (status === "paid") form.elements.paidAmount.value = monthlyFee;
    if (status === "unpaid") form.elements.paidAmount.value = 0;
  }

  async function saveInlinePayment(form) {
    const paymentId = form.dataset.paymentId;
    const message = form.querySelector("[data-payment-inline-message]");
    if (message) message.textContent = "";
    try {
      await api(paymentId ? `/api/payments/${paymentId}` : "/api/payments", {
        method: paymentId ? "PATCH" : "POST",
        body: JSON.stringify(paymentPayloadFromInlineForm(form))
      });
      state.editingPaymentRowKey = null;
      await loadPayments();
      await loadDashboard();
      setNotice(paymentId ? "Ödeme güncellendi." : "Ödeme kaydedildi.");
    } catch (_error) {
      if (message) message.textContent = "Ödeme güncellenirken hata oluştu.";
      setNotice("Ödeme güncellenirken hata oluştu.", true);
    }
  }

  async function loadPayments() {
    if (!can("payments:read")) return;
    if (isSuperAdmin() && !state.selectedClub) {
      switchView("superAdminView");
      return;
    }
    const month = els.paymentMonthFilter.value || monthValue();
    els.paymentMonthFilter.value = month;
    await loadStudents({ q: "", status: "all", activeOn: `${month}-01`, render: false });
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
    const search = (els.paymentSearch?.value || "").trim().toLocaleLowerCase("tr-TR");
    const status = els.paymentStatusFilter?.value || "all";
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
        const rowKey = paymentRowKey(payment);
        const editRow = state.editingPaymentRowKey === rowKey ? renderPaymentEditRow(payment, rowKey) : "";
        return `
          <tr class="payment-row mobile-record-card">
            <td data-label="Öğrenci"><strong>${escapeHtml(payment.studentName)}</strong><br><span class="muted">${recordNo({ id: payment.studentId })}</span></td>
            <td data-label="Veli">${escapeHtml(payment.parentName || "-")}</td>
            <td data-label="Telefon">${escapeHtml(payment.phone || "-")}</td>
            <td data-label="Ay">${monthLabel(payment.periodMonth)}</td>
            <td data-label="Ücret" class="money">${money(payment.monthlyFee)}</td>
            <td data-label="Ödenen" class="money">${money(payment.paidAmount)}</td>
            <td data-label="Kalan" class="money">${money(payment.remainingAmount)}</td>
            <td data-label="Durum">${paymentStatusBadge(statusKey)}</td>
            <td data-label="İşlem">
              <div class="actions payment-actions">
                ${can("payments:write") ? `<button class="small-button secondary" data-action="edit-payment" data-row-key="${escapeHtml(rowKey)}" data-id="${escapeHtml(payment.id || "")}" data-student-id="${escapeHtml(payment.studentId || "")}" type="button">Düzenle</button>` : ""}
                ${can("payments:delete") && payment.id ? `<button class="small-button danger" data-action="delete-payment" data-id="${payment.id}" type="button">Ödemeyi Sil</button>` : `<button class="small-button danger" type="button" disabled>Ödemeyi Sil</button>`}
                ${whatsApp ? `<a class="small-button whatsapp" href="${whatsApp}" target="_blank" rel="noopener">WhatsApp</a>` : `<span class="small-button disabled">WhatsApp</span>`}
              </div>
            </td>
          </tr>
          ${editRow}
        `;
      }).join("")
      : emptyRow(9, "Bu ay ödeme kaydı bulunamadı.", "Filtreleri değiştirerek tekrar deneyebilirsiniz.");
  }

  function syncPaymentFee() {
    const option = els.paymentStudent.selectedOptions[0];
    if (option && !state.editingPaymentId) {
      els.paymentMonthlyFee.value = option.dataset.fee || 0;
      syncPaymentStatusFromAmounts();
    }
  }

  function applyPaymentStatusToAmount() {
    const status = els.paymentEditStatus?.value || "partial";
    const fee = Number(els.paymentMonthlyFee?.value || 0);
    if (status === "paid") els.paymentPaidAmount.value = fee;
    if (status === "unpaid") els.paymentPaidAmount.value = 0;
  }

  function syncPaymentStatusFromAmounts() {
    if (!els.paymentEditStatus) return;
    els.paymentEditStatus.value = paymentStatusFromAmounts(els.paymentMonthlyFee?.value, els.paymentPaidAmount?.value);
  }

  function resetPaymentForm() {
    if (!els.paymentForm) return;
    state.editingPaymentId = null;
    state.editingPaymentRowKey = null;
    if (els.paymentId) els.paymentId.value = "";
    if (els.paymentStudent) els.paymentStudent.disabled = false;
    if (els.paymentPaidAmount) els.paymentPaidAmount.value = "";
    if (els.paymentPeriodMonth) els.paymentPeriodMonth.value = els.paymentMonthFilter?.value || monthValue();
    if (els.paymentDate) els.paymentDate.value = new Date().toISOString().slice(0, 10);
    if (els.paymentMethod) els.paymentMethod.value = "";
    if (els.paymentDescription) els.paymentDescription.value = "";
    if (els.paymentEditStatus) els.paymentEditStatus.value = "partial";
    if (els.savePaymentButton) els.savePaymentButton.textContent = "Ödeme Ekle";
    els.cancelPaymentEditButton?.classList.add("hidden");
    syncPaymentFee();
  }

  function startPaymentEdit(payment) {
    if (!payment?.id) return;
    state.editingPaymentId = payment.id;
    if (els.paymentId) els.paymentId.value = payment.id;
    if (els.paymentStudent) {
      els.paymentStudent.value = String(payment.studentId || "");
      els.paymentStudent.disabled = true;
    }
    if (els.paymentMonthlyFee) els.paymentMonthlyFee.value = Number(payment.monthlyFee || 0);
    if (els.paymentPaidAmount) els.paymentPaidAmount.value = Number(payment.paidAmount || 0);
    if (els.paymentEditStatus) els.paymentEditStatus.value = paymentStatus(payment);
    if (els.paymentPeriodMonth) els.paymentPeriodMonth.value = monthInputValue(payment.periodMonth);
    if (els.paymentDate) els.paymentDate.value = dateInputValue(payment.paymentDate);
    if (els.paymentMethod) els.paymentMethod.value = payment.method || "";
    if (els.paymentDescription) els.paymentDescription.value = payment.description || "";
    if (els.savePaymentButton) els.savePaymentButton.textContent = "Ödemeyi Güncelle";
    els.cancelPaymentEditButton?.classList.remove("hidden");
    els.paymentForm?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderImportPreview() {
    if (!can("students:import")) return;
    const rows = state.importPreview?.rows || [];
    const summary = state.importPreview?.summary || {};
    els.importSummary.innerHTML = [
      metricCard("Okunan Satır", summary.readRows ?? 0, "navy", "Dosyadan okundu"),
      metricCard("Aktarılacak", summary.readyRows ?? 0, "green", "Onaya hazır"),
      metricCard("Duplicate", summary.duplicateRows ?? 0, "gold", "Atlanacak"),
      metricCard("Hatalı", summary.errorRows ?? 0, "red", "Düzeltilmeli")
    ].join("");

    const errorRows = rows.filter((row) => (row.errors || []).length);
    els.importErrorsPanel.classList.toggle("hidden", !errorRows.length);
    els.importErrors.innerHTML = errorRows.length
      ? errorRows.slice(0, 40).map((row) => `
          <div class="compact-item">
            <div><strong>Satır ${escapeHtml(row.rowNumber)}</strong><span>${escapeHtml(row.fullName || "-")}</span></div>
            <span class="badge bad">${escapeHtml((row.errors || []).join(", "))}</span>
          </div>
        `).join("")
      : "";

    els.importCommitButton.classList.toggle("hidden", !(summary.readyRows > 0));
    els.importPreviewTable.innerHTML = rows.length
      ? rows.slice(0, 200).map((row) => {
        const status = row.errors?.length ? "Hatalı" : row.duplicate ? "Duplicate" : "Hazır";
        const tone = row.errors?.length ? "bad" : row.duplicate ? "warn" : "good";
        return `
          <tr>
            <td data-label="Satır">${escapeHtml(row.rowNumber)}</td>
            <td data-label="Öğrenci"><strong>${escapeHtml(row.fullName || "-")}</strong></td>
            <td data-label="Telefon">${escapeHtml(row.phone || "-")}</td>
            <td data-label="Program">${escapeHtml(row.program || "-")}</td>
            <td data-label="Gün/Saat">${escapeHtml([row.day, row.time].filter(Boolean).join(" ") || "-")}</td>
            <td data-label="Ücret" class="money">${money(row.monthlyFee)}</td>
            <td data-label="Durum"><span class="badge ${tone}">${escapeHtml(status)}</span></td>
          </tr>
        `;
      }).join("")
      : emptyRow(7, "Henüz dosya önizlenmedi.", "Excel dosyası seçip Önizle butonuna basın.");
  }

  async function previewImportFile() {
    if (!els.importFile.files.length) {
      setNotice("Önizleme için Excel dosyası seçin.", true);
      return;
    }
    const formData = new FormData();
    formData.append("file", els.importFile.files[0]);
    const data = await api("/api/import/students/preview", {
      method: "POST",
      body: formData
    });
    state.importPreview = data;
    renderImportPreview();
  }

  async function commitImportRows() {
    const rows = state.importPreview?.rows || [];
    if (!rows.length) {
      setNotice("Önce dosyayı önizleyin.", true);
      return;
    }
    const data = await api("/api/import/students/commit", {
      method: "POST",
      body: JSON.stringify({ rows: rows.filter((row) => row.ready) })
    });
    state.importPreview = null;
    els.importFile.value = "";
    renderImportPreview();
    await loadStudents();
    await loadDashboard();
    setNotice(`${data.report?.insertedStudents || 0} öğrenci içe aktarıldı.`);
  }

  async function loadUsers() {
    if (!can("users:read")) return;
    if (isSuperAdmin() && !state.clubs.length) {
      await loadClubs();
    }
    populateUserClubControls();
    const params = new URLSearchParams();
    const search = (els.userSearch?.value || "").trim();
    const role = els.userRoleFilter?.value || "all";
    const club = els.userClubFilter?.value || "all";
    if (search) params.set("search", search);
    if (role !== "all") params.set("role", role);
    if (club !== "all") params.set("clubId", club);
    const query = params.toString();
    const data = await api(`/api/users${query ? `?${query}` : ""}`);
    const users = data.users || [];
    els.userTable.innerHTML = users.length
      ? users.map((user) => `
          <tr>
            <td data-label="Ad Soyad"><strong>${escapeHtml(user.fullName || "-")}</strong><br><span class="muted">${escapeHtml(userDisplayLine(user))}</span></td>
            <td data-label="Kullanıcı adı / e-posta">${escapeHtml(user.username || "-")}</td>
            <td data-label="Rol">${roleBadge(user.normalizedRole || user.role, user.roleLabel)}</td>
            <td data-label="Bağlı Kulüp">${escapeHtml(userClubName(user))}</td>
            <td data-label="Durum">${user.active ? statusBadge("Aktif") : statusBadge("Pasif")}</td>
            <td data-label="Son işlem">${escapeHtml(userDateLabel(user) || "-")}</td>
            <td data-label="İşlemler">
              <div class="actions">
                <button class="small-button secondary" data-action="edit-user" data-id="${user.id}" type="button">Düzenle</button>
                <button class="small-button ${user.active ? "danger" : ""}" data-action="toggle-user-active" data-id="${user.id}" data-active="${user.active ? "false" : "true"}" type="button">${user.active ? "Pasif Yap" : "Aktif Yap"}</button>
                <button class="small-button danger" data-action="soft-delete-user" data-id="${user.id}" type="button">Sil</button>
              </div>
            </td>
          </tr>
        `).join("")
      : emptyRow(7, "Kullanıcı bulunamadı.", "Arama veya filtre kriterlerini değiştirerek tekrar deneyin.");
    state.users = users;
    updateUserRoleOptions();
  }

  function populateUserClubControls() {
    const clubOptions = state.clubs.map((club) => `<option value="${club.id}">${escapeHtml(club.name)}</option>`).join("");
    if (els.userClubFilter) {
      const current = els.userClubFilter.value || "all";
      els.userClubFilter.innerHTML = `<option value="all">Tüm kulüpler</option><option value="center">Kulüp Asistanı Merkez</option>${clubOptions}`;
      els.userClubFilter.value = Array.from(els.userClubFilter.options).some((option) => option.value === current) ? current : "all";
      els.userClubFilter.disabled = !isSuperAdmin();
    }
    if (els.newUserClubId) {
      const current = els.newUserClubId.value || "";
      els.newUserClubId.innerHTML = `<option value="">Kulüp Asistanı Merkez</option>${clubOptions}`;
      els.newUserClubId.value = Array.from(els.newUserClubId.options).some((option) => option.value === current) ? current : "";
    }
  }

  function updateUserRoleOptions() {
    if (!els.newUserRole) return;
    const allowed = isSuperAdmin()
      ? ["super_admin", "manager", "coordinator", "coach", "assistant", "viewer"]
      : (normalizedRole() === "manager" ? ["manager", "coach", "assistant"] : ["coach", "assistant"]);
    Array.from(els.newUserRole.options).forEach((option) => {
      option.hidden = !allowed.includes(option.value);
      option.disabled = !allowed.includes(option.value);
    });
    if (!allowed.includes(els.newUserRole.value)) els.newUserRole.value = allowed[0];
    if (els.newUserClubId) {
      const role = els.newUserRole.value;
      const clubRequired = role !== "super_admin";
      els.newUserClubId.required = clubRequired && isSuperAdmin();
      els.newUserClubId.disabled = !isSuperAdmin();
      if (!isSuperAdmin()) {
        els.newUserClubId.value = String(state.user?.clubId || "");
      }
      if (role === "super_admin") els.newUserClubId.value = "";
    }
    updateCoachScopeHint();
  }

  function updateCoachScopeHint() {
    if (!els.coachScopeHint || !els.newUserRole) return;
    els.coachScopeHint.classList.toggle("hidden", els.newUserRole.value !== "coach");
  }

  function resetUserForm() {
    if (!els.userForm) return;
    els.userForm.reset();
    if (els.editUserId) els.editUserId.value = "";
    if (els.newUserActive) els.newUserActive.value = "true";
    if (els.newUserPassword) {
      els.newUserPassword.value = "";
      els.newUserPassword.required = true;
    }
    if (els.newUserPasswordConfirm) {
      els.newUserPasswordConfirm.value = "";
      els.newUserPasswordConfirm.required = true;
    }
    if (els.newUserClubId && !isSuperAdmin()) {
      els.newUserClubId.value = String(state.user?.clubId || "");
    }
    if (els.saveUserButton) els.saveUserButton.textContent = "Kullanıcı Ekle";
    els.cancelUserEditButton?.classList.add("hidden");
    updateUserRoleOptions();
  }

  function startUserEdit(user) {
    if (!user) return;
    if (els.editUserId) els.editUserId.value = user.id;
    const usernameInput = $("#newUsername");
    const fullNameInput = $("#newUserFullName");
    if (usernameInput) usernameInput.value = user.username || "";
    if (fullNameInput) fullNameInput.value = user.fullName || "";
    if (els.newUserRole) els.newUserRole.value = user.normalizedRole || user.role || "coach";
    if (els.newUserClubId) els.newUserClubId.value = user.clubId ? String(user.clubId) : "";
    if (els.newUserActive) els.newUserActive.value = user.active ? "true" : "false";
    if (els.newUserPassword) {
      els.newUserPassword.value = "";
      els.newUserPassword.required = false;
    }
    if (els.newUserPasswordConfirm) {
      els.newUserPasswordConfirm.value = "";
      els.newUserPasswordConfirm.required = false;
    }
    if (els.saveUserButton) els.saveUserButton.textContent = "Kullanıcıyı Güncelle";
    els.cancelUserEditButton?.classList.remove("hidden");
    updateUserRoleOptions();
  }

  async function loadBackups() {
    if (!can("backup:read")) return;
    if (isSuperAdmin() && !state.selectedClub) {
      switchView("superAdminView");
      return;
    }
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
    populateLessonControls();
    els.attendanceDate.value = new Date().toISOString().slice(0, 10);
    els.paymentDate.value = new Date().toISOString().slice(0, 10);
    els.paymentMonthFilter.value = monthValue();
    els.loginUsername.value = localStorage.getItem("kulupasist.rememberedUsername") || localStorage.getItem("emba.rememberedUsername") || "";
    els.rememberMe.checked = Boolean(els.loginUsername.value);
    clearStudentForm();
    resetPaymentForm();
    resetUserForm();

    try {
      const data = await api("/api/auth/me");
      state.user = data.user;
      if (shouldRestoreAppSession()) {
        await enterAuthenticatedApp(storedActiveView());
      } else {
        showLoginWithExistingSession(data.user);
      }
    } catch (_error) {
      showLogin();
    }
  }

  els.mobileMenuButton.addEventListener("click", openMobileMenu);
  els.sidebarOverlay.addEventListener("click", closeMobileMenu);
  [els.brandHomeButton, els.mobileBrandHomeButton].filter(Boolean).forEach((button) => {
    button.addEventListener("click", () => switchView(homeViewForRole()));
  });

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
          password: els.loginPassword.value,
          rememberMe: els.rememberMe.checked
        })
      });
      if (els.rememberMe.checked) localStorage.setItem("kulupasist.rememberedUsername", username);
      else {
        localStorage.removeItem("kulupasist.rememberedUsername");
        localStorage.removeItem("emba.rememberedUsername");
      }
      state.user = data.user;
      state.selectedClub = null;
      els.loginPassword.value = "";
      await enterAuthenticatedApp(homeViewForRole());
    } catch (error) {
      els.loginMessage.textContent = error.message;
      els.loginMessage.classList.add("error");
    }
  });

  els.continueSessionButton?.addEventListener("click", async () => {
    try {
      els.loginMessage.textContent = "";
      els.loginMessage.classList.remove("error");
      await continueExistingSession();
    } catch (error) {
      showLogin();
      els.loginMessage.textContent = error.message;
      els.loginMessage.classList.add("error");
    }
  });

  els.logoutButton.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("kulupasist.rememberedUsername");
    localStorage.removeItem("emba.rememberedUsername");
    clearAppSessionState();
    els.loginUsername.value = "";
    els.loginPassword.value = "";
    els.rememberMe.checked = false;
    showLogin();
  });

  els.backToClubsButton.addEventListener("click", clearSelectedClub);

  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  els.refreshDashboardButton.addEventListener("click", loadDashboard);
  els.studentStatusFilter.addEventListener("change", loadStudents);
  [els.globalSearch, els.paymentSearch, els.userSearch, els.attendanceCardSearch].forEach(setupExpandingSearch);
  setupExpandingSearchFallbacks();
  els.globalSearch.addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      if (currentStudentSearch() || state.activeView === "studentsView") runStudentSearch();
    }, 220);
  });
  els.globalSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runStudentSearch();
    }
  });
  els.globalSearchButton?.addEventListener("click", runStudentSearch);
  els.globalSearchClearButton?.addEventListener("click", clearStudentSearch);

  els.newStudentButton.addEventListener("click", () => openStudentEditor());
  els.cancelStudentButton.addEventListener("click", () => {
    els.studentEditor.classList.add("hidden");
    state.editingStudentInlineId = null;
    restoreStudentEditorHome();
    renderStudents();
  });
  $("#studentBirthYear")?.addEventListener("input", () => updateAgeGroupFromBirthYear(false));
  $("#studentBirthYear")?.addEventListener("blur", () => updateAgeGroupFromBirthYear(true));
  $("#studentStatus")?.addEventListener("change", updatePassiveDateField);

  els.clubCreateUser.addEventListener("change", () => {
    els.clubUserFields.classList.toggle("hidden", !els.clubCreateUser.checked);
  });

  els.clubForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = readClubForm();
      if (payload.user && payload.user.password !== payload.user.passwordConfirm) {
        setNotice("Yönetici şifreleri eşleşmiyor.", true);
        return;
      }
      await api("/api/clubs", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      els.clubForm.reset();
      els.clubUserFields.classList.add("hidden");
      await loadClubs();
      setNotice("Kulüp eklendi.");
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  els.importForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await previewImportFile();
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  els.importCommitButton.addEventListener("click", async () => {
    try {
      await commitImportRows();
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  els.studentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.studentSaving) return;
    if ($("#studentBirthYear").value && !ageGroupFromBirthYear($("#studentBirthYear").value)) {
      setNotice("Geçerli bir doğum yılı giriniz.", true);
      return;
    }
    const id = $("#studentId").value;
    if ($("#studentStatus").value === "Pasif") {
      updatePassiveDateField();
      if (!$("#studentPassiveDate").value) {
        setNotice("Pasife alma tarihi seçilmelidir.", true);
        return;
      }
      const confirmed = window.confirm(
        "Bu öğrenci seçilen tarihten sonraki ay itibarıyla ödeme ve yoklama listelerine dahil edilmeyecek. Geçmiş ödeme ve yoklama kayıtları korunacak."
      );
      if (!confirmed) return;
    }
    const method = id ? "PATCH" : "POST";
    const url = id ? `/api/students/${id}` : "/api/students";
    const submitButton = els.studentForm.querySelector('button[type="submit"]');
    const originalText = submitButton?.textContent || "Kaydet";
    state.studentSaving = true;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Kaydediliyor...";
    }
    try {
      await api(url, { method, body: JSON.stringify(readStudentForm()) });
      clearStudentForm();
      els.studentEditor.classList.add("hidden");
      state.editingStudentInlineId = null;
      restoreStudentEditorHome();
      await loadStudents();
      await loadDashboard();
      setNotice(id ? "Öğrenci güncellendi." : "Öğrenci kaydedildi.");
    } catch (error) {
      const detail = error?.message ? ` ${error.message}` : "";
      setNotice(`Öğrenci kaydedilirken hata oluştu.${detail}`, true);
    } finally {
      state.studentSaving = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
      }
    }
  });

  document.body.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.action;
    try {
      if (action === "detail-student") await showStudentDetail(id);
      if (action === "toggle-student-actions") {
        state.openStudentActionsId = state.openStudentActionsId === String(id) ? null : String(id);
        renderStudents();
      }
      if (action === "manage-club") await selectClub(id);
      if (action === "edit-student") openStudentEditor(state.students.find((student) => String(student.id) === String(id)), { inline: true });
      if (action === "student-payment") {
        const student = state.students.find((item) => String(item.id) === String(id));
        if (student && els.paymentSearch) els.paymentSearch.value = student.fullName || "";
        switchView("paymentsView");
      }
      if (action === "student-attendance-detail") await showStudentDetail(id);
      if (action === "mark-attendance") markLessonAttendance(id, button.dataset.status);
      if (action === "toggle-attendance-times") {
        state.attendanceTimesOpen = !state.attendanceTimesOpen;
        renderAttendanceTimeGrid();
      }
      if (action === "select-attendance-time") {
        els.attendanceSlotTime.value = button.dataset.time || "";
        state.attendanceTimesOpen = false;
        state.attendanceListCollapsed = false;
        await loadLessonAttendance();
        if (state.manualAttendanceOpen) await loadManualAttendanceCandidates();
      }
      if (action === "add-manual-attendance-student") await addManualAttendanceStudent(id);
      if (action === "open-attendance-slot") {
        state.pendingAttendanceTime = button.dataset.time || "";
        switchView("attendanceView");
      }
      if (action === "go-student-create") switchView("studentCreateView");
      if (action === "go-attendance") switchView("attendanceView");
      if (action === "toggle-report-session") await toggleAttendanceReportSession(button.dataset.sessionId);
      if (action === "edit-report-session") {
        state.editingReportSessionId = button.dataset.sessionId;
        renderAttendanceReportSessions();
      }
      if (action === "cancel-report-edit") {
        state.editingReportSessionId = null;
        renderAttendanceReportSessions();
      }
      if (action === "save-report-session") await saveAttendanceReportSession(button.dataset.sessionId);
      if (action === "reset-attendance-session") openAttendanceResetModal(button.dataset.sessionId);
      if (action === "cancel-attendance-session") {
        setNotice("Yoklama iptali şu anda aktif değil.", true);
      }
      if (action === "edit-user") startUserEdit(state.users.find((user) => String(user.id) === String(id)));
      if (action === "toggle-user-active") {
        const user = state.users.find((item) => String(item.id) === String(id));
        const active = button.dataset.active === "true";
        if (!user || !window.confirm(`${user.username} kullanıcısı ${active ? "aktif" : "pasif"} yapılsın mı?`)) return;
        await api(`/api/users/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            username: user.username,
            fullName: user.fullName,
            role: user.normalizedRole || user.role,
            clubId: user.clubId || null,
            active
          })
        });
        await loadUsers();
        setNotice("Kullanıcı durumu güncellendi.");
      }
      if (action === "soft-delete-user") {
        const user = state.users.find((item) => String(item.id) === String(id));
        if (!user || !window.confirm("Bu kullanıcıyı silmek/pasife almak istediğinize emin misiniz?")) return;
        await api(`/api/users/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            username: user.username,
            fullName: user.fullName,
            role: user.normalizedRole || user.role,
            clubId: user.clubId || null,
            active: false
          })
        });
        await loadUsers();
        setNotice("Kullanıcı güvenli şekilde pasife alındı.");
      }
      if (action === "delete-student") {
        const student = state.students.find((item) => String(item.id) === String(id));
        if (!student) return;
        const passiveDate = window.prompt("Pasife alınma tarihini girin (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
        if (!passiveDate) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(passiveDate)) {
          setNotice("Pasife alma tarihi YYYY-MM-DD formatında olmalı.", true);
          return;
        }
        const confirmed = window.confirm("Bu öğrenci seçilen tarihten sonraki ay itibarıyla ödeme ve yoklama listelerine dahil edilmeyecek. Geçmiş ödeme ve yoklama kayıtları korunacak.");
        if (!confirmed) return;
        await api(`/api/students/${id}`, {
          method: "PATCH",
          body: JSON.stringify(studentPayloadFromExisting(student, "Pasif", passiveDate))
        });
        await loadStudents();
        await loadDashboard();
        setNotice("Öğrenci pasife alındı.");
      }
      if (action === "delete-payment" && window.confirm("Bu ödeme kaydı silinsin mi?")) {
        await api(`/api/payments/${id}`, { method: "DELETE" });
        await loadPayments();
        await loadDashboard();
        setNotice("Ödeme silindi.");
      }
      if (action === "edit-payment") {
        state.editingPaymentRowKey = button.dataset.rowKey || (id ? `payment-${id}` : `student-${button.dataset.studentId || ""}`);
        renderPayments();
      }
      if (action === "cancel-payment-inline") {
        state.editingPaymentRowKey = null;
        renderPayments();
      }
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  document.body.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-payment-edit-form]");
    if (!form) return;
    event.preventDefault();
    await saveInlinePayment(form);
  });

  document.body.addEventListener("change", (event) => {
    const statusSelect = event.target.closest("[data-payment-inline-status]");
    if (!statusSelect) return;
    const form = statusSelect.closest("[data-payment-edit-form]");
    if (form) syncInlinePaymentAmount(form);
  });

  document.body.addEventListener("input", (event) => {
    const form = event.target.closest("[data-payment-edit-form]");
    if (!form || event.target.name !== "paidAmount") return;
    form.elements.status.value = paymentStatusFromAmounts(form.elements.monthlyFee.value, form.elements.paidAmount.value);
  });

  els.attendanceDate.addEventListener("change", loadAttendance);
  els.attendanceSlotTime.addEventListener("change", async () => {
    state.attendanceListCollapsed = false;
    await loadLessonAttendance();
    if (state.manualAttendanceOpen) await loadManualAttendanceCandidates();
  });
  els.attendanceCardSearch.addEventListener("input", renderAttendanceCards);
  els.manualAttendanceToggle?.addEventListener("click", async () => {
    state.manualAttendanceOpen = !state.manualAttendanceOpen;
    if (state.manualAttendanceOpen) await loadManualAttendanceCandidates();
    else renderManualAttendancePanel();
  });
  els.manualAttendanceSearch?.addEventListener("input", () => {
    window.clearTimeout(state.manualAttendanceTimer);
    state.manualAttendanceTimer = window.setTimeout(() => {
      loadManualAttendanceCandidates().catch((error) => setNotice(error.message, true));
    }, 220);
  });
  els.saveBulkAttendanceButton.addEventListener("click", async () => {
    try {
      await saveLessonAttendance();
      await loadDashboard();
      setNotice("Yoklama başarıyla kaydedildi.");
    } catch (error) {
      setNotice(error.message, true);
    }
  });
  els.clearAttendanceButton?.addEventListener("click", openSelectedAttendanceClearModal);
  els.attendanceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/attendance", {
        method: "POST",
        body: JSON.stringify({
          studentId: els.attendanceStudent.value,
          lessonDate: els.attendanceDate.value,
          dayOfWeek: $("#attendanceDay").value.trim(),
          startTime: normalizeTimeValue($("#attendanceTime").value),
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

  els.attendanceReportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await loadAttendanceReport();
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  els.reportType?.addEventListener("change", () => {
    els.reportWeekWrap?.classList.toggle("hidden", els.reportType.value !== "weekly");
    if (els.reportType.value === "weekly" && els.reportWeekStart) {
      els.reportWeekStart.value = weekStartValue(els.reportWeekStart.value || els.reportDate.value);
    }
    loadAttendanceReport();
  });
  els.reportWeekStart?.addEventListener("change", loadAttendanceReport);
  els.printAttendanceReportButton?.addEventListener("click", printAttendanceReport);
  els.cancelAttendanceResetButton?.addEventListener("click", closeAttendanceResetModal);
  els.confirmAttendanceResetButton?.addEventListener("click", confirmAttendanceReset);
  els.attendanceResetModal?.addEventListener("click", (event) => {
    if (event.target === els.attendanceResetModal) closeAttendanceResetModal();
  });
  els.attendanceResetConfirmInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmAttendanceReset();
    }
  });

  els.paymentStudent.addEventListener("change", syncPaymentFee);
  els.paymentEditStatus?.addEventListener("change", applyPaymentStatusToAmount);
  els.paymentMonthlyFee?.addEventListener("input", () => {
    if (els.paymentEditStatus?.value === "paid") applyPaymentStatusToAmount();
    else syncPaymentStatusFromAmounts();
  });
  els.paymentPaidAmount?.addEventListener("input", syncPaymentStatusFromAmounts);
  els.cancelPaymentEditButton?.addEventListener("click", resetPaymentForm);
  els.paymentMonthFilter.addEventListener("change", () => {
    resetPaymentForm();
    loadPayments();
  });
  els.paymentSearch.addEventListener("input", renderPayments);
  els.paymentSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      renderPayments();
    }
  });
  els.paymentSearchButton?.addEventListener("click", renderPayments);
  els.paymentSearchClearButton?.addEventListener("click", () => {
    els.paymentSearch.value = "";
    renderPayments();
  });
  els.paymentStatusFilter.addEventListener("change", renderPayments);
  els.paymentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = els.paymentId?.value || "";
    const payload = {
      periodMonth: els.paymentPeriodMonth?.value || els.paymentMonthFilter.value,
      monthlyFee: els.paymentMonthlyFee.value,
      paidAmount: els.paymentPaidAmount.value,
      status: els.paymentEditStatus?.value || "partial",
      paymentDate: els.paymentDate.value,
      method: els.paymentMethod.value.trim(),
      description: els.paymentDescription.value.trim()
    };
    if (!id) payload.studentId = els.paymentStudent.value;
    try {
      await api(id ? `/api/payments/${id}` : "/api/payments", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload)
      });
      resetPaymentForm();
      await loadPayments();
      await loadDashboard();
      setNotice(id ? "Ödeme güncellendi." : "Ödeme kaydedildi.");
    } catch (error) {
      setNotice(id ? "Ödeme güncellenirken hata oluştu." : error.message, true);
    }
  });

  els.newUserRole?.addEventListener("change", updateCoachScopeHint);
  els.newUserRole?.addEventListener("change", updateUserRoleOptions);

  els.userForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const id = els.editUserId.value;
      const body = {
        username: $("#newUsername").value.trim(),
        fullName: $("#newUserFullName").value.trim(),
        role: $("#newUserRole").value,
        clubId: els.newUserClubId?.value || null,
        active: els.newUserActive.value === "true"
      };
      const password = els.newUserPassword?.value || "";
      const passwordConfirm = els.newUserPasswordConfirm?.value || "";
      if (password || passwordConfirm) {
        if (password !== passwordConfirm) {
          setNotice("Şifre ve şifre tekrar eşleşmiyor.", true);
          return;
        }
        body.passwordConfirm = passwordConfirm;
      }
      if (password) body.password = password;
      await api(id ? `/api/users/${id}` : "/api/users", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(body)
      });
      resetUserForm();
      await loadUsers();
      setNotice(id ? "Kullanıcı güncellendi." : "Kullanıcı eklendi.");
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  els.cancelUserEditButton.addEventListener("click", resetUserForm);
  els.newUserButton?.addEventListener("click", () => {
    resetUserForm();
    els.userForm?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  els.userSearchButton?.addEventListener("click", loadUsers);
  els.userSearchClearButton?.addEventListener("click", () => {
    if (els.userSearch) els.userSearch.value = "";
    if (els.userRoleFilter) els.userRoleFilter.value = "all";
    if (els.userClubFilter) els.userClubFilter.value = "all";
    loadUsers();
  });
  els.userSearch?.addEventListener("input", () => {
    window.clearTimeout(state.userSearchTimer);
    state.userSearchTimer = window.setTimeout(loadUsers, 300);
  });
  els.userRoleFilter?.addEventListener("change", loadUsers);
  els.userClubFilter?.addEventListener("change", loadUsers);

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
