;(function (root) {
  const TRANSIENT_STATUS = new Set([502, 503, 504])
  const isTransientStatus = (status) => TRANSIENT_STATUS.has(status)
  const isConnectionError = (error) => error && (error.name === 'TypeError' || error.code === 'ERR_CONNECTION_REFUSED')
  const shouldRetry = ({ status, error, attempt, maxAttempts }) => {
    if (attempt >= maxAttempts - 1) return false
    return Boolean(isTransientStatus(status) || isConnectionError(error))
  }
  const retryDelay = (attempt) => 250 * (2 ** attempt)
  const classifyFailure = ({ status, error } = {}) => {
    if (isConnectionError(error) || status == null) return { category: 'network-retryable', retryable: true }
    if (status === 401 || status === 403) return { category: 'authorization-required', retryable: true }
    if (status === 400 || status === 404 || status === 415 || status === 422) return { category: 'invalid-media-candidate', retryable: false }
    if (isTransientStatus(status)) return { category: 'app-unavailable', retryable: true }
    return { category: 'app-rejected', retryable: false }
  }
  const shouldFallback = ({ status, error } = {}) => classifyFailure({ status, error }).retryable
  const mergeRetryResults = (results, retryIndexes, retryResults) => {
    const merged = results.slice()
    retryIndexes.forEach((originalIndex, retryIndex) => {
      const fallback = retryResults[retryIndex]
      if (!fallback) return
      const original = merged[originalIndex] || {}
      const classification = fallback.category || fallback.ok ? {} : classifyFailure({ status: fallback.status, error: fallback.error ? { name: fallback.error } : undefined })
      merged[originalIndex] = {
        ...fallback,
        ...(fallback.category ? {} : classification),
        ...(fallback.category || (typeof fallback.status === 'number' && fallback.status > 0) || !original.category ? {} : { category: original.category, retryable: original.retryable })
      }
    })
    return merged
  }
  root.VDownloadDownloadTransport = { isTransientStatus, isConnectionError, shouldRetry, retryDelay, classifyFailure, shouldFallback, mergeRetryResults }
})(typeof globalThis !== 'undefined' ? globalThis : this)
