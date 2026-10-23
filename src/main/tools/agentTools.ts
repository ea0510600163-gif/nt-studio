export function selectModeTools<T extends { name: string }>(mode: 'studio' | 'agent', all: readonly T[]): T[] {
  void mode
  return all as T[]
}
