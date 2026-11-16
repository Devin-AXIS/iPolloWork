export function isSessionNotFound(code) {
  return code === 'session-not-found' || code === 'session/not-found';
}

// Older Hosts report corrupt logs as generic internal errors. Only recognize
// storage/format signatures on Session RPCs, never arbitrary internal failures.
export function isSessionLogCorrupt(error) {
  return ['internal', 'gateway/internal'].includes(error?.code)
    && ['session.history', 'session.prompt'].includes(error?.method)
    && /stored log is corrupt|stored session "[^"\n]+" is corrupt|SessionFormatError:/u.test(error?.message ?? '');
}
