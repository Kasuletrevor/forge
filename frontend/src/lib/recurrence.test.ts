import { describe, expect, it } from 'vitest'
import {
  applyAdvancedRule,
  applyDurationMinutes,
  buildRRule,
  createDefaultRecurrenceState,
  recurrencePreview,
  recurrenceQuickPresets,
  recurrenceStateFromRule,
  type RecurrenceWeekday,
} from './recurrence'

describe('recurrence helpers', () => {
  it('generates weekly RRULEs from weekday selection', () => {
    const state = {
      ...createDefaultRecurrenceState('2026-03-10T09:00'),
      mode: 'weekly' as const,
      unit: 'week' as const,
      weekdays: ['MO', 'WE'] as RecurrenceWeekday[],
    }

    expect(buildRRule(state, '2026-03-10T09:00')).toBe('FREQ=WEEKLY;BYDAY=MO,WE')
  })

  it('parses supported weekly RRULEs into builder state', () => {
    const state = recurrenceStateFromRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH', '2026-03-10T09:00')

    expect(state.mode).toBe('weekly')
    expect(state.interval).toBe(2)
    expect(state.weekdays).toEqual(['TU', 'TH'])
    expect(state.advancedOverride).toBe(false)
  })

  it('generates monthly nth weekday RRULEs', () => {
    const state = {
      ...createDefaultRecurrenceState('2026-03-06T09:00'),
      mode: 'monthly' as const,
      unit: 'month' as const,
      monthlyPattern: 'nth_weekday' as const,
      ordinal: 1 as const,
      ordinalWeekday: 'FR' as const,
      weekdays: ['FR'] as RecurrenceWeekday[],
    }

    expect(buildRRule(state, '2026-03-06T09:00')).toBe('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1')
  })

  it('builds preview sentences for weekly events', () => {
    const state = recurrenceStateFromRule('FREQ=WEEKLY;BYDAY=MO,WE', '2026-03-10T09:00')

    expect(recurrencePreview(state, '2026-03-10T09:00')).toBe(
      'Occurs every week on Monday and Wednesday at 9:00 AM',
    )
  })

  it('keeps unsupported manual RRULE input as an advanced override', () => {
    const current = createDefaultRecurrenceState('2026-03-10T09:00')
    const next = applyAdvancedRule(current, 'FREQ=YEARLY;BYMONTH=3', '2026-03-10T09:00')

    expect(next.advancedOverride).toBe(true)
    expect(next.advancedRRule).toBe('FREQ=YEARLY;BYMONTH=3')
  })

  it('applies duration presets to ISO timestamps', () => {
    const updated = applyDurationMinutes('2026-03-10T09:00:00.000Z', 120, 'iso')

    expect(updated.endValue).toBe('2026-03-10T11:00:00.000Z')
  })

  it('returns work-oriented quick presets', () => {
    const presets = recurrenceQuickPresets('2026-03-10T09:00')

    expect(presets.map((preset) => preset.label)).toEqual([
      'Daily Deep Work',
      'Weekly Research Block',
      'Planning Session',
    ])
    expect(presets[0].minutes).toBe(120)
    expect(buildRRule(presets[0].state, '2026-03-10T09:00')).toBe(
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    )
  })
})
