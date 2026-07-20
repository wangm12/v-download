;(function (root) {
  const TRANSIENT_STATUS = new Set([502, 503, 504])
  const isTransientStatus = (status) => TRANSIENT_STATUS.has(status)
  const isConnectionError = (error) => error && (error.name === 'TypeError' || error.code === 'ERR_CONNECTION_REFUSED')
  const shouldRetry = ({ status, error, attempt, maxAttempts }) => {
    if (attempt >= maxAttempts - 1) return false
    return Boolean(isTransientStatus(status) || isConnectionError(error))
  }
  const retryDelay = (attempt) => 250 * (2 ** attempt)
  root.VDownloadDownloadTransport = { isTransientStatus, isConnectionError, shouldRetry, retryDelay }
})(typeof globalThis !== 'undefined' ? globalThis : this)
