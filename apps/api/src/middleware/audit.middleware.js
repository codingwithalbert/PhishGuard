function auditLog(event, req, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.userId || null,
    role: req.user?.role || null,
    ...details
  };

  console.log("[AUDIT]", JSON.stringify(entry));
}

module.exports = {
  auditLog
};