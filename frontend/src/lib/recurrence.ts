export type RecurrenceMode = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom'
export type RecurrenceUnit = 'day' | 'week' | 'month'
export type RecurrenceEndMode = 'never' | 'on' | 'after'
export type MonthlyPattern = 'month_day' | 'nth_weekday'
export type RecurrenceWeekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'
export type MonthlyOrdinal = 1 | 2 | 3 | 4 | -1

export interface RecurrenceState {
  mode: RecurrenceMode
  unit: RecurrenceUnit
  interval: number
  weekdays: RecurrenceWeekday[]
  monthlyPattern: MonthlyPattern
  monthDay: number
  ordinal: MonthlyOrdinal
  ordinalWeekday: RecurrenceWeekday
  endMode: RecurrenceEndMode
  untilDate: string
  count: number
  advancedRRule: string
  advancedOverride: boolean
}

const weekdayOrder: RecurrenceWeekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const weekdayLabels: Record<RecurrenceWeekday, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
}
const weekdayShortLabels: Record<RecurrenceWeekday, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
}
const monthlyOrdinalLabels: Record<MonthlyOrdinal, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  [-1]: 'last',
}

function defaultWeekday(startValue: string | null | undefined) {
  const date = parseDateInput(startValue)
  return weekdayFromDate(date)
}

export function createDefaultRecurrenceState(startValue?: string | null): RecurrenceState {
  const weekday = defaultWeekday(startValue)
  return {
    mode: 'none',
    unit: 'week',
    interval: 1,
    weekdays: [weekday],
    monthlyPattern: 'month_day',
    monthDay: clampMonthDay(parseDateInput(startValue)?.getDate() ?? 1),
    ordinal: 1,
    ordinalWeekday: weekday,
    endMode: 'never',
    untilDate: '',
    count: 10,
    advancedRRule: '',
    advancedOverride: false,
  }
}

export function recurrenceStateFromRule(
  rule: string | null | undefined,
  startValue?: string | null,
): RecurrenceState {
  const normalized = normalizeRule(rule)
  if (!normalized) {
    return createDefaultRecurrenceState(startValue)
  }

  const parts = parseRuleParts(normalized)
  const startDate = parseDateInput(startValue)
  const weekday = defaultWeekday(startValue)
  const freq = parts.FREQ
  const interval = clampPositiveInteger(parts.INTERVAL, 1)
  const byDay = normalizeWeekdays(parts.BYDAY?.split(',').filter(Boolean))
  const monthDay = clampMonthDay(clampPositiveInteger(parts.BYMONTHDAY, startDate?.getDate() ?? 1))
  const bySetPos = normalizeOrdinal(parts.BYSETPOS)
  const count = clampPositiveInteger(parts.COUNT, 10)
  const untilDate = parseUntilDate(parts.UNTIL)
  const endMode: RecurrenceEndMode = parts.COUNT
    ? 'after'
    : parts.UNTIL
      ? 'on'
      : 'never'

  const base = createDefaultRecurrenceState(startValue)
  const next: RecurrenceState = {
    ...base,
    interval,
    weekdays: byDay.length ? byDay : [weekday],
    monthDay,
    ordinal: bySetPos ?? inferOrdinalFromDate(startDate),
    ordinalWeekday: byDay[0] ?? weekday,
    endMode,
    untilDate,
    count,
    advancedRRule: normalized,
    advancedOverride: false,
  }

  if (freq === 'DAILY' && !parts.BYDAY && !parts.BYMONTHDAY && !parts.BYSETPOS) {
    next.mode = 'daily'
    next.unit = 'day'
    return next
  }

  if (freq === 'WEEKLY' && !parts.BYMONTHDAY && !parts.BYSETPOS) {
    next.mode = 'weekly'
    next.unit = 'week'
    return withGeneratedAdvancedRule(next, startValue)
  }

  if (freq === 'MONTHLY' && parts.BYMONTHDAY && !parts.BYSETPOS) {
    next.mode = 'monthly'
    next.unit = 'month'
    next.monthlyPattern = 'month_day'
    return withGeneratedAdvancedRule(next, startValue)
  }

  if (freq === 'MONTHLY' && byDay.length === 1 && bySetPos) {
    next.mode = 'monthly'
    next.unit = 'month'
    next.monthlyPattern = 'nth_weekday'
    next.weekdays = byDay
    next.ordinalWeekday = byDay[0]
    return withGeneratedAdvancedRule(next, startValue)
  }

  if (freq === 'DAILY' || freq === 'WEEKLY' || freq === 'MONTHLY') {
    next.mode = 'custom'
    next.unit = frequencyToUnit(freq)
    return next
  }

  return {
    ...next,
    mode: 'custom',
    unit: 'week',
    advancedOverride: true,
  }
}

export function applyAdvancedRule(
  current: RecurrenceState,
  rule: string,
  startValue?: string | null,
) {
  const normalized = normalizeRule(rule)
  if (!normalized) {
    return createDefaultRecurrenceState(startValue)
  }

  const parsed = recurrenceStateFromRule(normalized, startValue)
  if (parsed.advancedOverride) {
    return {
      ...current,
      advancedRRule: normalized,
      advancedOverride: true,
    }
  }

  return parsed
}

export function buildRRule(state: RecurrenceState, startValue?: string | null) {
  if (state.advancedOverride) {
    return normalizeRule(state.advancedRRule)
  }

  if (state.mode === 'none') {
    return null
  }

  const parts: string[] = []
  const interval = Math.max(1, Math.trunc(state.interval || 1))

  if (state.mode === 'daily') {
    parts.push('FREQ=DAILY')
    if (interval !== 1) {
      parts.push(`INTERVAL=${interval}`)
    }
  } else if (state.mode === 'weekly') {
    const weekdays = normalizeWeekdays(state.weekdays)
    parts.push('FREQ=WEEKLY')
    if (interval !== 1) {
      parts.push(`INTERVAL=${interval}`)
    }
    parts.push(`BYDAY=${(weekdays.length ? weekdays : [defaultWeekday(startValue)]).join(',')}`)
  } else if (state.mode === 'monthly') {
    parts.push('FREQ=MONTHLY')
    if (interval !== 1) {
      parts.push(`INTERVAL=${interval}`)
    }
    if (state.monthlyPattern === 'nth_weekday') {
      parts.push(`BYDAY=${state.ordinalWeekday}`)
      parts.push(`BYSETPOS=${state.ordinal}`)
    } else {
      parts.push(`BYMONTHDAY=${clampMonthDay(state.monthDay)}`)
    }
  } else {
    parts.push(`FREQ=${unitToFrequency(state.unit)}`)
    if (interval !== 1) {
      parts.push(`INTERVAL=${interval}`)
    }
    if (state.unit === 'week') {
      parts.push(`BYDAY=${(normalizeWeekdays(state.weekdays).length ? normalizeWeekdays(state.weekdays) : [defaultWeekday(startValue)]).join(',')}`)
    }
    if (state.unit === 'month') {
      if (state.monthlyPattern === 'nth_weekday') {
        parts.push(`BYDAY=${state.ordinalWeekday}`)
        parts.push(`BYSETPOS=${state.ordinal}`)
      } else {
        parts.push(`BYMONTHDAY=${clampMonthDay(state.monthDay)}`)
      }
    }
  }

  appendEnding(parts, state.untilDate, state.count, state.endMode)
  return parts.join(';')
}

export function recurrencePreview(state: RecurrenceState, startValue?: string | null) {
  const time = previewTime(startValue)
  if (state.advancedOverride) {
    return time ? `Occurs via custom RRULE at ${time}` : 'Occurs via custom RRULE'
  }

  if (state.mode === 'none') {
    return 'Does not repeat'
  }

  const interval = Math.max(1, Math.trunc(state.interval || 1))
  let sentence = 'Occurs '

  if (state.mode === 'daily') {
    sentence += interval === 1 ? 'every day' : `every ${interval} days`
  } else if (state.mode === 'weekly') {
    sentence += weeklyPreview(interval, state.weekdays, startValue)
  } else if (state.mode === 'monthly') {
    sentence += monthlyPreview(state, interval)
  } else if (state.unit === 'day') {
    sentence += interval === 1 ? 'every day' : `every ${interval} days`
  } else if (state.unit === 'week') {
    sentence += weeklyPreview(interval, state.weekdays, startValue)
  } else {
    sentence += monthlyPreview(state, interval)
  }

  if (time) {
    sentence += ` at ${time}`
  }

  if (state.endMode === 'on' && state.untilDate) {
    sentence += ` until ${previewDate(state.untilDate)}`
  } else if (state.endMode === 'after') {
    sentence += ` for ${Math.max(1, Math.trunc(state.count || 1))} occurrences`
  }

  return sentence
}

export function applyDurationMinutes(startValue: string, minutes: number, format: 'iso' | 'local') {
  const start = parseDateInput(startValue)
  if (!start) {
    return { startValue, endValue: startValue }
  }
  const end = new Date(start.getTime() + minutes * 60 * 1000)
  return {
    startValue,
    endValue: format === 'iso' ? end.toISOString() : toDatetimeLocal(end),
  }
}

export function recurrenceQuickPresets(startValue?: string | null) {
  const startDate = parseDateInput(startValue)
  const startWeekday = weekdayFromDate(startDate)
  return [
    {
      id: 'daily-deep-work',
      label: 'Daily Deep Work',
      minutes: 120,
      state: withGeneratedAdvancedRule(
        {
          ...createDefaultRecurrenceState(startValue),
          mode: 'weekly',
          unit: 'week',
          weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'],
        },
        startValue,
      ),
    },
    {
      id: 'weekly-research',
      label: 'Weekly Research Block',
      minutes: 120,
      state: withGeneratedAdvancedRule(
        {
          ...createDefaultRecurrenceState(startValue),
          mode: 'weekly',
          unit: 'week',
          weekdays: [startWeekday],
        },
        startValue,
      ),
    },
    {
      id: 'planning-session',
      label: 'Planning Session',
      minutes: 60,
      state: withGeneratedAdvancedRule(
        {
          ...createDefaultRecurrenceState(startValue),
          mode: 'weekly',
          unit: 'week',
          weekdays: ['MO'],
        },
        startValue,
      ),
    },
  ]
}

export function weekdayChipLabel(day: RecurrenceWeekday) {
  return weekdayShortLabels[day]
}

export function supportedWeekdays() {
  return weekdayOrder
}

function withGeneratedAdvancedRule(state: RecurrenceState, startValue?: string | null) {
  const nextRule = buildRRule({ ...state, advancedOverride: false }, startValue)
  return {
    ...state,
    advancedRRule: nextRule ?? '',
    advancedOverride: false,
  }
}

function appendEnding(parts: string[], untilDate: string, count: number, endMode: RecurrenceEndMode) {
  if (endMode === 'on' && untilDate) {
    parts.push(`UNTIL=${untilDateToRRule(untilDate)}`)
  } else if (endMode === 'after') {
    parts.push(`COUNT=${Math.max(1, Math.trunc(count || 1))}`)
  }
}

function parseRuleParts(rule: string) {
  const parts: Record<string, string> = {}
  for (const segment of rule.split(';')) {
    const [key, ...rest] = segment.split('=')
    if (!key || rest.length === 0) {
      continue
    }
    parts[key.toUpperCase()] = rest.join('=').trim().toUpperCase()
  }
  return parts
}

function normalizeRule(rule: string | null | undefined) {
  const trimmed = rule?.trim() ?? ''
  return trimmed ? trimmed.toUpperCase() : null
}

function normalizeWeekdays(days: string[] | undefined) {
  if (!days) {
    return []
  }
  return weekdayOrder.filter((day) => days.includes(day))
}

function normalizeOrdinal(value: string | undefined): MonthlyOrdinal | null {
  if (!value) {
    return null
  }
  const parsed = Number(value)
  if (parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4 || parsed === -1) {
    return parsed
  }
  return null
}

function clampPositiveInteger(value: string | number | undefined, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback
  }
  return Math.trunc(parsed)
}

function clampMonthDay(value: number) {
  return Math.min(31, Math.max(1, Math.trunc(value)))
}

function parseUntilDate(value: string | undefined) {
  if (!value) {
    return ''
  }
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return ''
  }
  return toDateInput(parsed)
}

function untilDateToRRule(value: string) {
  const compact = value.replaceAll('-', '')
  return `${compact}T235959Z`
}

function previewDate(value: string) {
  const parsed = parseDateInput(value)
  if (!parsed) {
    return value
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

function previewTime(value: string | null | undefined) {
  const parsed = parseDateInput(value)
  if (!parsed) {
    return ''
  }
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

function weeklyPreview(interval: number, weekdays: RecurrenceWeekday[], startValue?: string | null) {
  const days = weekdays.length ? weekdays : [defaultWeekday(startValue)]
  const cadence = interval === 1 ? 'every week' : `every ${interval} weeks`
  return `${cadence} on ${humanizeWeekdays(days)}`
}

function monthlyPreview(state: RecurrenceState, interval: number) {
  const cadence = interval === 1 ? 'every month' : `every ${interval} months`
  if (state.monthlyPattern === 'nth_weekday') {
    return `${cadence} on the ${monthlyOrdinalLabels[state.ordinal]} ${weekdayLabels[state.ordinalWeekday]}`
  }
  return `${cadence} on day ${clampMonthDay(state.monthDay)}`
}

function humanizeWeekdays(days: RecurrenceWeekday[]) {
  const labels = normalizeWeekdays(days).map((day) => weekdayLabels[day])
  if (labels.length === 0) {
    return 'Monday'
  }
  if (labels.length === 1) {
    return labels[0]
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`
  }
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`
}

function frequencyToUnit(freq: string): RecurrenceUnit {
  if (freq === 'DAILY') {
    return 'day'
  }
  if (freq === 'MONTHLY') {
    return 'month'
  }
  return 'week'
}

function unitToFrequency(unit: RecurrenceUnit) {
  if (unit === 'day') {
    return 'DAILY'
  }
  if (unit === 'month') {
    return 'MONTHLY'
  }
  return 'WEEKLY'
}

function parseDateInput(value: string | null | undefined) {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed
  }
  return null
}

function weekdayFromDate(date: Date | null): RecurrenceWeekday {
  if (!date) {
    return 'MO'
  }
  return weekdayOrder[(date.getDay() + 6) % 7]
}

function inferOrdinalFromDate(date: Date | null): MonthlyOrdinal {
  if (!date) {
    return 1
  }
  const day = date.getDate()
  if (day >= 29) {
    return -1
  }
  return Math.min(4, Math.ceil(day / 7)) as MonthlyOrdinal
}

function toDateInput(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toDatetimeLocal(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}
