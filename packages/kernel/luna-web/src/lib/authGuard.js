// Wave 4 bug 9: pure 401 policy. A 401 only means "session expired" when we
// actually presented a token and the endpoint is not the login attempt itself.
export function shouldForceLogout({ status, url = '', hasToken }) {
  if (status !== 401 || !hasToken) return false;
  if (url && url.includes('/api/auth/login')) return false;
  return true;
}
