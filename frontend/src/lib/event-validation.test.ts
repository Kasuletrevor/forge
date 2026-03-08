import { describe, expect, it } from 'vitest'
import {
  normalizeRRule,
  validateEventMutationDraft,
} from './event-validation'

describe('normalizeRRule', () => {
  it('trims recurrence rules and clears blank values', () => {
    expect(normalizeRRule('  FREQ=WEEKLY;BYDAY=MO  ')).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(normalizeRRule('   ')).toBeNull()
    expect(normalizeRRule(null)).toBeNull()
  })
})

describe('validateEventMutationDraft', () => {
  const validDraft = {
    title: 'Research block',
    startAt: '2026-03-10T09:00:00Z',
    endAt: '2026-03-10T10:30:00Z',
    timezone: 'UTC',
    rrule: null,
  }

  it('rejects invalid timezones with an actionable message', () => {
    expect(
      validateEventMutationDraft({
        ...validDraft,
        timezone: 'Mars/Olympus',
      }),
    ).toContain('Invalid timezone')
  })

  it('rejects blank recurrence rules', () => {
    expect(
      validateEventMutationDraft({
        ...validDraft,
        rrule: '   ',
      }),
    ).toBe('Recurrence rule must not be empty.')
  })

  it('accepts valid recurring payloads', () => {
    expect(
      validateEventMutationDraft({
        ...validDraft,
        timezone: 'Africa/Kampala',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
      }),
    ).toBeNull()
  })
})
