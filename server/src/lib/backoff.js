// Exponential delay with a cap and some randomness (jitter), so devices
// reconnecting together don't hit the server at the same instant. attempt
// starts at 0.
export function backoffDelay(
  attempt,
  { baseMs = 1000, maxMs = 60000, jitter = 0.2, random = Math.random } = {}
) {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt))
  const spread = exponential * jitter
  return Math.round(Math.min(maxMs, Math.max(0, exponential - spread + random() * 2 * spread)))
}
