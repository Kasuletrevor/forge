export interface EventMutationDraft {
  title?: string
  startAt: string | null | undefined
  endAt: string | null | undefined
  timezone: string
  rrule?: string | null
}

export function normalizeRRule(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

export function validateEventMutationDraft(
  draft: EventMutationDraft,
  options?: { requireTitle?: boolean },
) {
  const requireTitle = options?.requireTitle ?? true
  if (requireTitle && !draft.title?.trim()) {
    return 'Event title must not be empty.'
  }

  if (!draft.startAt || !draft.endAt) {
    return 'Event start and end times are both required.'
  }

  const start = new Date(draft.startAt)
  const end = new Date(draft.endAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'Event timestamps must be valid date-time values.'
  }
  if (end <= start) {
    return 'Event end time must be after the start time.'
  }

  if (!isValidTimeZone(draft.timezone)) {
    return `Invalid timezone '${draft.timezone}'. Use an IANA timezone like UTC or Africa/Kampala.`
  }

  const rrule = normalizeRRule(draft.rrule)
  if (draft.rrule !== undefined && draft.rrule !== null && !rrule) {
    return 'Recurrence rule must not be empty.'
  }
  if (rrule && !rrule.toUpperCase().includes('FREQ=')) {
    return 'Recurrence rule must include FREQ=, for example FREQ=WEEKLY;BYDAY=MO.'
  }

  return null
}

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}
