import { describe, expect, it } from 'vitest'
import { isTypingTarget, screenFromShortcut } from './keyboard'

describe('screenFromShortcut', () => {
  it('maps number shortcuts to screens', () => {
    expect(screenFromShortcut('1')).toBe('today')
    expect(screenFromShortcut('2')).toBe('projects')
    expect(screenFromShortcut('3')).toBe('tasks')
    expect(screenFromShortcut('4')).toBe('calendar')
    expect(screenFromShortcut('5')).toBe('settings')
    expect(screenFromShortcut('x')).toBeNull()
  })
})

describe('isTypingTarget', () => {
  it('treats form controls as typing targets', () => {
    expect(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true)
  })

  it('ignores non-editable elements', () => {
    expect(isTypingTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})
