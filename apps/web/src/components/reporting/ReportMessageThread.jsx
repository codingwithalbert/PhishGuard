import { useId, useState } from "react";
import { formatReportingDate } from "./reportingUi";

function getMessageText(message) {
  return typeof message?.message === "string" ? message.message : "";
}

function getSenderName(message) {
  return typeof message?.sender?.name === "string" &&
    message.sender.name.length > 0
    ? message.sender.name
    : "Unknown sender";
}

function getSenderRole(message) {
  return typeof message?.sender?.role === "string" &&
    message.sender.role.length > 0
    ? message.sender.role
    : "Unknown role";
}

function ReportMessageThread({
  messages = [],
  canSend = false,
  onSend,
  isSending = false,
  sendError = null,
  emptyMessage = "No messages have been sent for this Report.",
  composerLabel = "Message"
}) {
  const [draft, setDraft] = useState("");
  const messageInputId = useId();
  const safeMessages = Array.isArray(messages) ? messages : [];
  const showComposer = canSend && typeof onSend === "function";
  const errorMessage =
    typeof sendError === "string"
      ? sendError
      : sendError?.message || null;

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedMessage = draft.trim();

    if (
      isSending ||
      !trimmedMessage ||
      typeof onSend !== "function"
    ) {
      return;
    }

    try {
      const result = await onSend(trimmedMessage);

      if (result !== false) {
        setDraft("");
      }
    } catch {
      // The parent owns error presentation; keep the draft for retry.
    }
  }

  return (
    <div className="report-thread">
      <h3>Report conversation</h3>

      {safeMessages.length === 0 ? (
        <p className="report-thread-empty">{emptyMessage}</p>
      ) : (
        <ol className="report-message-list">
          {safeMessages.map((message, index) => {
            const senderRole = getSenderRole(message);
            const isReviewerMessage =
              senderRole === "staff" || senderRole === "admin";
            const messageText = getMessageText(message);

            return (
              <li
                className={`report-message ${
                  isReviewerMessage
                    ? "report-message-reviewer"
                    : "report-message-reporter"
                }`}
                key={message?.id || `message-${index}`}
              >
                <div className="report-message-heading">
                  <span>{getSenderName(message)}</span>
                  <span>{senderRole}</span>
                  <time dateTime={message?.createdAt}>
                    {formatReportingDate(message?.createdAt)}
                  </time>
                </div>

                <p>
                  {messageText || "Message unavailable"}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {showComposer && (
        <form
          className="report-thread-form"
          onSubmit={handleSubmit}
        >
          <label htmlFor={messageInputId}>
            {composerLabel}
          </label>

          <textarea
            id={messageInputId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={1000}
            required
            disabled={isSending}
          />

          <p className="report-thread-reminder">
            Do not include passwords, MFA codes, authentication tokens, or
            other authentication secrets.
          </p>

          {errorMessage && (
            <p role="alert">{errorMessage}</p>
          )}

          <button
            type="submit"
            disabled={isSending || draft.trim().length === 0}
          >
            {isSending ? "Sending..." : "Send message"}
          </button>
        </form>
      )}
    </div>
  );
}

export default ReportMessageThread;
