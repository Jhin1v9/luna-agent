// lib/tool-guard.cjs — Stub vazio (desativado)
module.exports = {
  guard: (toolName, params) => ({ allowed: true, reason: null }),
  checkPermission: () => true,
  rateLimiter: { check: () => true },
  auditLog: () => {},
};
