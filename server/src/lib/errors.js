// Errors shown to the user carry a stable code: the interface translates it
// (client/src/i18n), the English message is only a fallback and for logs.
export class AppError extends Error {
  constructor(code, message, { status = 400, params } = {}) {
    super(message)
    this.code = code
    this.status = status
    this.params = params
  }
}

export function sendError(res, status, code, message, params) {
  return res.status(status).json({ error: message, code, ...(params && { params }) })
}

// For route catch blocks: AppErrors keep their code and status
export function sendRouteError(res, error, fallbackStatus = 400) {
  if (error instanceof AppError) {
    return sendError(res, error.status, error.code, error.message, error.params)
  }
  return res.status(fallbackStatus).json({ error: error.message })
}
