const ROLE_ALIASES = {
  admin: "manager",
  koordinator: "coordinator",
  antrenor: "coach",
  izleyici: "viewer",
  super_admin: "super_admin",
  manager: "manager",
  coordinator: "coordinator",
  coach: "coach",
  assistant: "assistant",
  viewer: "viewer"
};

const ROLE_LABELS = {
  super_admin: "Otomasyon Sorumlusu",
  manager: "Kulup Yetkilisi",
  coordinator: "Koordinator",
  coach: "Antrenor",
  assistant: "Asistan",
  viewer: "Izleyici",
  admin: "Admin",
  koordinator: "Koordinator",
  antrenor: "Antrenor",
  izleyici: "Izleyici"
};

const ALL_PERMISSIONS = [
  "dashboard:read",
  "students:read",
  "students:write",
  "students:delete",
  "students:import",
  "attendance:read",
  "attendance:write",
  "payments:read",
  "payments:write",
  "payments:delete",
  "users:read",
  "users:write",
  "audit:read",
  "backup:read",
  "backup:run"
];

const ROLE_PERMISSIONS = {
  super_admin: ALL_PERMISSIONS,
  manager: ALL_PERMISSIONS,
  coordinator: [
    "dashboard:read",
    "students:read",
    "students:write",
    "students:import",
    "attendance:read",
    "attendance:write",
    "payments:read",
    "payments:write"
  ],
  coach: [
    "dashboard:read",
    "students:read",
    "students:write",
    "attendance:read",
    "attendance:write"
  ],
  assistant: [
    "dashboard:read",
    "students:read",
    "students:write",
    "attendance:read",
    "attendance:write"
  ],
  viewer: [
    "dashboard:read",
    "students:read",
    "attendance:read"
  ]
};

const USER_CREATABLE_ROLES = [
  "admin",
  "koordinator",
  "antrenor",
  "assistant",
  "izleyici",
  "manager",
  "coordinator",
  "coach",
  "viewer"
];

const DATABASE_ROLE_ALIASES = {
  manager: "manager",
  coordinator: "coordinator",
  coach: "coach",
  assistant: "assistant",
  viewer: "viewer",
  admin: "manager",
  koordinator: "coordinator",
  antrenor: "coach",
  izleyici: "viewer"
};

function normalizeRole(role) {
  return ROLE_ALIASES[String(role || "").trim()] || "viewer";
}

function normalizeUserRole(user) {
  const username = String(user?.username || "").trim().toLowerCase();
  const role = String(user?.role || user?.normalizedRole || "").trim();
  if (username === "admin" && role === "admin") {
    return "super_admin";
  }
  return normalizeRole(role);
}

function roleLabel(role) {
  return ROLE_LABELS[role] || ROLE_LABELS[normalizeRole(role)] || String(role || "viewer");
}

function permissionsFor(role) {
  return ROLE_PERMISSIONS[normalizeRole(role)] || [];
}

function can(user, permission) {
  if (!user || !permission) return false;
  return permissionsFor(normalizeUserRole(user)).includes(permission);
}

function isSuperAdmin(user) {
  return normalizeUserRole(user) === "super_admin";
}

function isCoach(user) {
  return normalizeUserRole(user) === "coach";
}

function normalizeCreatableRole(role, actor) {
  const requested = String(role || "").trim();
  if (requested === "super_admin") {
    return null;
  }
  if (!USER_CREATABLE_ROLES.includes(requested)) return "viewer";
  const normalized = DATABASE_ROLE_ALIASES[requested] || "viewer";
  if (actor && !isSuperAdmin(actor) && !["coach", "assistant", "viewer"].includes(normalized)) {
    return null;
  }
  return normalized;
}

module.exports = {
  ROLE_ALIASES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  USER_CREATABLE_ROLES,
  DATABASE_ROLE_ALIASES,
  normalizeRole,
  normalizeUserRole,
  roleLabel,
  permissionsFor,
  can,
  isSuperAdmin,
  isCoach,
  normalizeCreatableRole
};
