const {
  recordAuditEvent: defaultRecordAuditEvent,
  AUDIT_ERROR_CODES
} = require("./audit.service");

// Shared, bounded, best-effort persistent audit writer.
//
// WHY THIS EXISTS: the login, registration, and password-reset controllers each
// record a durable audit event for their handled outcomes, and they must all
// behave identically when the database misbehaves. The race against the wait
// limit, the single sanitized diagnostic, and the late-settlement handling
// therefore live here in exactly one place instead of being copied per
// controller.
//
// The write is started exactly once and awaited for at most
// `auditRecordTimeoutMs`. Both a settled write and the timer are reduced to a
// plain outcome string, so the underlying write's own promise can never reject
// into an unhandled rejection even when it settles after the wait limit. The
// late outcome is intentionally discarded: a write that fails or times out is
// reported once, a write that arrives late is neither reported again nor treated
// as a second failure, and a failed write is never retried. The write is never
// cancelled by this code; it may still complete after the limit.

// Maximum time a request will wait for the persistent audit write to settle.
// Kept deliberately small and local to audit recording; it is not a global
// MongoDB option and does not abort the write itself.
const AUDIT_RECORD_TIMEOUT_MS = 1500;

const AUDIT_PERSISTENCE_FAILED_EVENT = "AUDIT_PERSISTENCE_FAILED";

// Fixed, sanitized diagnostic. The caught error is deliberately discarded and
// never logged, so no driver message, connection string, event payload, or
// credential can reach the output.
function reportAuditPersistenceFailure() {
  console.error(
    "[AUDIT_PERSISTENCE]",
    JSON.stringify({
      event: AUDIT_PERSISTENCE_FAILED_EVENT,
      code: AUDIT_ERROR_CODES.PERSISTENCE_FAILED
    })
  );
}

// Builds a best-effort writer bound to a recorder and a wait limit. The returned
// function resolves once the write settles or the wait limit elapses, whichever
// comes first, and never throws.
function createBoundedAuditWriter({
  recordAuditEvent = defaultRecordAuditEvent,
  auditRecordTimeoutMs = AUDIT_RECORD_TIMEOUT_MS
} = {}) {
  return async function persistAuditEvent(event) {
    let timer = null;

    const writeOutcome = Promise.resolve()
      .then(() => recordAuditEvent(event))
      .then(
        () => "settled",
        () => "failed"
      );

    const waitLimit = new Promise((resolve) => {
      timer = setTimeout(() => resolve("timeout"), auditRecordTimeoutMs);
    });

    const outcome = await Promise.race([writeOutcome, waitLimit]);

    clearTimeout(timer);

    if (outcome !== "settled") {
      reportAuditPersistenceFailure();
    }
  };
}

module.exports = {
  AUDIT_PERSISTENCE_FAILED_EVENT,
  AUDIT_RECORD_TIMEOUT_MS,
  createBoundedAuditWriter
};
