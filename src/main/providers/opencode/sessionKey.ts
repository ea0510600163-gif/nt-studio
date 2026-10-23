export function opencodeSessionKey(providerId: string, projectId?: string | null): string {
  const pid = (providerId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '') || 'unknown'
  const jid = projectId ? projectId.replace(/[^A-Za-z0-9_-]/g, '') : ''
  return jid ? `nt-${pid}-${jid}` : `nt-${pid}-app`
}
