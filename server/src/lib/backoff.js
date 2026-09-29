// Ritardo esponenziale con tetto e un po' di casualità (jitter), così più
// dispositivi che si riconnettono insieme non colpiscono il server allo
// stesso istante. attempt parte da 0.
export function backoffDelay(attempt, { baseMs = 1000, maxMs = 60000, jitter = 0.2, random = Math.random } = {}) {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt))
  const spread = exponential * jitter
  return Math.round(Math.min(maxMs, Math.max(0, exponential - spread + random() * 2 * spread)))
}
