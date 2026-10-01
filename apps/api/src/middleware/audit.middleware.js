function auditLog(event, req, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    method: req.method,
    path: req.originalUrl.split("?", 1)[0],
    userId: req.user?.userId || null,
    role: req.user?.role || null,
    ...details
  };

  console.log("[AUDIT]", JSON.stringify(entry));
}

module.exports = {
  auditLog
};
