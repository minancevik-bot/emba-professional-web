const ROLE_LABELS = {
  admin: "Admin",
  koordinator: "Koordinatör",
  antrenor: "Antrenör",
  izleyici: "İzleyici"
};

const ROLE_PERMISSIONS = {
  admin: [
    "dashboard:read",
    "students:read",
    "students:write",
    "students:delete",
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
  ],
  koordinator: [
    "dashboard:read",
    "students:read",
    "students:write",
    "attendance:read",
    "attendance:write",
    "payments:read",
    "payments:write",
    "audit:read",
    "backup:read"
  ],
  antrenor: [
    "dashboard:read",
    "students:read",
    "attendance:read",
    "attendance:write"
  ],
  izleyici: [
    "dashboard:read",
    "students:read",
    "attendance:read"
  ]
};

function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function can(user, permission) {
  if (!user || !permission) return false;
  return permissionsFor(user.role).includes(permission);
}

module.exports = {
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  permissionsFor,
  can
};
