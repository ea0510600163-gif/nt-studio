export const APPS_PS_COMMAND = [
  '$keys = @(',
  "  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
  "  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
  "  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
  ')',
  'Get-ItemProperty $keys -ErrorAction SilentlyContinue |',
  '  Where-Object { $_.DisplayName } |',
  '  Sort-Object DisplayName -Unique |',
  '  ForEach-Object { "$($_.DisplayName) | $($_.DisplayVersion) | $($_.Publisher)" }'
].join('\n')

export function parseInstalledApps(text: string, cap = 400): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const name = line.split('|')[0]?.trim() ?? ''
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
    if (out.length >= cap) break
  }
  return out
}
