export type ShortcutScreen =
  | 'today'
  | 'projects'
  | 'tasks'
  | 'calendar'
  | 'settings'

const screenShortcutMap: Record<string, ShortcutScreen> = {
  '1': 'today',
  '2': 'projects',
  '3': 'tasks',
  '4': 'calendar',
  '5': 'settings',
}

export function screenFromShortcut(key: string): ShortcutScreen | null {
  return screenShortcutMap[key] ?? null
}

export function isTypingTarget(target: EventTarget | null) {
  const element = target as
    | { tagName?: string; isContentEditable?: boolean }
    | null
  if (!element) {
    return false
  }

  return (
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName ?? '') ||
    Boolean(element.isContentEditable)
  )
}
