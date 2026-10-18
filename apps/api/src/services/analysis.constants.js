// Shared domain constants for URL analysis.
//
// This is deliberately a LEAF module: it imports nothing. `Analysis.js` needs
// the same maximum the request validator applies, but the model cannot import
// it from `analysis.service.js`, because that service already imports the model
// and a second import direction would create a require cycle. A dependency-free
// constants module lets the validation boundary and the schema boundary share
// one value without either depending on the other.

/**
 * Maximum accepted length of a submitted URL, in characters.
 *
 * WHY 2048:
 *
 * - It is above every realistic real-world URL. The longest legitimate URLs in
 *   use are roughly 2000 characters including the query string; 2048 is the
 *   widely adopted practical ceiling for a single URL and therefore a value a
 *   user could plausibly already encounter, so the limit rejects automation
 *   rather than legitimate input.
 * - It is roughly twenty times the 100-character threshold at which the analyzer
 *   already scores a URL as unusually long (+10), so every URL that carries a
 *   real phishing signal is comfortably inside the limit.
 * - It bounds storage meaningfully. Without it the only ceiling is the 1 MB
 *   request-body cap, which would let one authenticated request persist roughly
 *   a megabyte of string. That value is then copied into the report evidence
 *   snapshot, multiplied across collections, and rendered back into the
 *   interface and the review queue. 2048 keeps a single stored document small
 *   enough that unbounded growth is bounded rather than merely rate-limited.
 *
 * The submitted URL is rejected outright when it exceeds this value. It is
 * never truncated, because a truncated URL is a different URL: the heuristics
 * would score different characters than the student submitted, and the stored
 * evidence would no longer be the evidence that was analysed.
 */
const MAX_ANALYSIS_URL_LENGTH = 2048;

module.exports = {
  MAX_ANALYSIS_URL_LENGTH
};