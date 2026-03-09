import { useMemo } from 'react'
import {
  applyAdvancedRule,
  applyDurationMinutes,
  buildRRule,
  recurrencePreview,
  recurrenceQuickPresets,
  supportedWeekdays,
  weekdayChipLabel,
  type MonthlyOrdinal,
  type RecurrenceMode,
  type RecurrenceState,
  type RecurrenceUnit,
} from '../lib/recurrence'

interface RecurrenceBuilderProps {
  startValue: string
  endValue: string
  timeFormat: 'iso' | 'local'
  value: RecurrenceState
  onChange: (state: RecurrenceState) => void
  onEndValueChange: (value: string) => void
}

const durationPresets = [
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
]

const monthlyOrdinals: Array<{ value: MonthlyOrdinal; label: string }> = [
  { value: 1, label: 'First' },
  { value: 2, label: 'Second' },
  { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' },
  { value: -1, label: 'Last' },
]

export function RecurrenceBuilder({
  startValue,
  endValue,
  timeFormat,
  value,
  onChange,
  onEndValueChange,
}: RecurrenceBuilderProps) {
  const generatedRule = useMemo(() => buildRRule(value, startValue) ?? '', [startValue, value])
  const preview = useMemo(() => recurrencePreview(value, startValue), [startValue, value])
  const presets = useMemo(() => recurrenceQuickPresets(startValue), [startValue])
  const durationMinutes = useMemo(() => diffMinutes(startValue, endValue), [endValue, startValue])

  return (
    <div className="mt-4 rounded-[28px] border border-forge-steel/15 bg-[#f5efe4] p-4">
      <div className="grid gap-4 md:grid-cols-[1.2fr,0.8fr]">
        <div className="grid gap-4">
          <BuilderField label="Repeat">
            <SelectRow
              value={value.mode}
              onChange={(nextMode) =>
                onChange(withBuilderUpdate(value, startValue, {
                  mode: nextMode as RecurrenceMode,
                  unit:
                    nextMode === 'daily'
                      ? 'day'
                      : nextMode === 'monthly'
                        ? 'month'
                        : 'week',
                }))
              }
              options={[
                { value: 'none', label: 'None' },
                { value: 'daily', label: 'Daily' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          </BuilderField>

          {value.mode !== 'none' ? (
            <>
              <BuilderField label="Every">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    className="w-20 rounded-2xl border border-forge-steel/20 bg-white px-3 py-2 text-sm"
                    min={1}
                    step={1}
                    type="number"
                    value={value.interval}
                    onChange={(event) =>
                      onChange(
                        withBuilderUpdate(value, startValue, {
                          interval: Math.max(1, Number(event.target.value) || 1),
                        }),
                      )
                    }
                  />
                  <SelectRow
                    value={value.mode === 'custom' ? value.unit : inferredUnit(value.mode)}
                    onChange={(nextUnit) =>
                      onChange(
                        withBuilderUpdate(value, startValue, {
                          unit: nextUnit as RecurrenceUnit,
                          weekdays:
                            nextUnit === 'week' && value.weekdays.length === 0
                              ? value.weekdays
                              : value.weekdays,
                        }),
                      )
                    }
                    options={
                      value.mode === 'custom'
                        ? [
                            { value: 'day', label: 'Day' },
                            { value: 'week', label: 'Week' },
                            { value: 'month', label: 'Month' },
                          ]
                        : [{ value: inferredUnit(value.mode), label: unitLabel(inferredUnit(value.mode)) }]
                    }
                    disabled={value.mode !== 'custom'}
                  />
                </div>
              </BuilderField>

              {(value.mode === 'weekly' || (value.mode === 'custom' && value.unit === 'week')) && (
                <BuilderField label="Days">
                  <div className="flex flex-wrap gap-2">
                    {supportedWeekdays().map((day) => {
                      const active = value.weekdays.includes(day)
                      return (
                        <ToggleChip
                          key={day}
                          active={active}
                          onClick={() => {
                            const nextWeekdays = active
                              ? value.weekdays.filter((item) => item !== day)
                              : [...value.weekdays, day]
                            onChange(withBuilderUpdate(value, startValue, { weekdays: nextWeekdays }))
                          }}
                        >
                          {weekdayChipLabel(day)}
                        </ToggleChip>
                      )
                    })}
                  </div>
                </BuilderField>
              )}

              {(value.mode === 'monthly' || (value.mode === 'custom' && value.unit === 'month')) && (
                <BuilderField label="Monthly Pattern">
                  <div className="grid gap-3">
                    <label className="flex items-center gap-3 rounded-2xl border border-forge-steel/15 bg-white px-4 py-3 text-sm">
                      <input
                        checked={value.monthlyPattern === 'month_day'}
                        name="monthly-pattern"
                        type="radio"
                        onChange={() => onChange(withBuilderUpdate(value, startValue, { monthlyPattern: 'month_day' }))}
                      />
                      <span>Day</span>
                      <input
                        className="w-16 rounded-xl border border-forge-steel/20 px-2 py-1"
                        min={1}
                        max={31}
                        step={1}
                        type="number"
                        value={value.monthDay}
                        onChange={(event) =>
                          onChange(
                            withBuilderUpdate(value, startValue, {
                              monthDay: Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                            }),
                          )
                        }
                      />
                      <span>of month</span>
                    </label>
                    <label className="flex flex-wrap items-center gap-3 rounded-2xl border border-forge-steel/15 bg-white px-4 py-3 text-sm">
                      <input
                        checked={value.monthlyPattern === 'nth_weekday'}
                        name="monthly-pattern"
                        type="radio"
                        onChange={() => onChange(withBuilderUpdate(value, startValue, { monthlyPattern: 'nth_weekday' }))}
                      />
                      <SelectRow
                        value={String(value.ordinal)}
                        onChange={(nextOrdinal) =>
                          onChange(
                            withBuilderUpdate(value, startValue, {
                              ordinal: Number(nextOrdinal) as MonthlyOrdinal,
                            }),
                          )
                        }
                        options={monthlyOrdinals.map((option) => ({
                          value: String(option.value),
                          label: option.label,
                        }))}
                      />
                      <SelectRow
                        value={value.ordinalWeekday}
                        onChange={(nextDay) =>
                          onChange(
                            withBuilderUpdate(value, startValue, {
                              ordinalWeekday: nextDay as typeof value.ordinalWeekday,
                              weekdays: [nextDay as typeof value.ordinalWeekday],
                            }),
                          )
                        }
                        options={supportedWeekdays().map((day) => ({
                          value: day,
                          label: weekdayChipLabel(day),
                        }))}
                      />
                    </label>
                  </div>
                </BuilderField>
              )}

              <BuilderField label="Ends">
                <div className="grid gap-3">
                  <RadioRow
                    checked={value.endMode === 'never'}
                    label="Never"
                    onChange={() => onChange(withBuilderUpdate(value, startValue, { endMode: 'never' }))}
                  />
                  <RadioRow
                    checked={value.endMode === 'on'}
                    label="On"
                    trailing={
                      <input
                        className="rounded-xl border border-forge-steel/20 bg-white px-3 py-2 text-sm"
                        type="date"
                        value={value.untilDate}
                        onChange={(event) =>
                          onChange(
                            withBuilderUpdate(value, startValue, {
                              endMode: 'on',
                              untilDate: event.target.value,
                            }),
                          )
                        }
                      />
                    }
                    onChange={() => onChange(withBuilderUpdate(value, startValue, { endMode: 'on' }))}
                  />
                  <RadioRow
                    checked={value.endMode === 'after'}
                    label="After"
                    trailing={
                      <input
                        className="w-24 rounded-xl border border-forge-steel/20 bg-white px-3 py-2 text-sm"
                        min={1}
                        step={1}
                        type="number"
                        value={value.count}
                        onChange={(event) =>
                          onChange(
                            withBuilderUpdate(value, startValue, {
                              endMode: 'after',
                              count: Math.max(1, Number(event.target.value) || 1),
                            }),
                          )
                        }
                      />
                    }
                    onChange={() => onChange(withBuilderUpdate(value, startValue, { endMode: 'after' }))}
                  />
                </div>
              </BuilderField>

              <BuilderField label="Duration">
                <div className="flex flex-wrap gap-2">
                  {durationPresets.map((preset) => (
                    <ToggleChip
                      key={preset.label}
                      active={durationMinutes === preset.minutes}
                      onClick={() => {
                        const next = applyDurationMinutes(startValue, preset.minutes, timeFormat)
                        onEndValueChange(next.endValue)
                      }}
                    >
                      {preset.label}
                    </ToggleChip>
                  ))}
                  <ToggleChip active={!durationPresets.some((preset) => preset.minutes === durationMinutes)} onClick={() => undefined}>
                    Custom
                  </ToggleChip>
                </div>
              </BuilderField>
            </>
          ) : null}
        </div>

        <div className="grid gap-4">
          <BuilderField label="Quick Schedules">
            <div className="grid gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  className="rounded-2xl border border-forge-steel/20 bg-white px-4 py-3 text-left transition hover:border-forge-rust hover:text-forge-rust"
                  type="button"
                  onClick={() => {
                    onChange(preset.state)
                    const next = applyDurationMinutes(startValue, preset.minutes, timeFormat)
                    onEndValueChange(next.endValue)
                  }}
                >
                  <div className="font-medium">{preset.label}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.16em] text-forge-steel">
                    {preset.minutes} minutes
                  </div>
                </button>
              ))}
            </div>
          </BuilderField>

          <BuilderField label="Preview">
            <div className="rounded-2xl border border-forge-steel/15 bg-white px-4 py-3 text-sm font-medium text-forge-ink">
              {preview}
            </div>
          </BuilderField>

          <details className="rounded-2xl border border-forge-steel/15 bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-forge-ink">
              Advanced RRULE
            </summary>
            <div className="border-t border-forge-steel/10 px-4 py-4">
              <textarea
                className="min-h-[100px] w-full rounded-2xl border border-forge-steel/20 bg-[#fbf9f4] px-3 py-3 text-sm uppercase tracking-[0.08em] text-forge-ink"
                value={value.advancedOverride ? value.advancedRRule : generatedRule}
                onChange={(event) => onChange(applyAdvancedRule(value, event.target.value, startValue))}
                placeholder="FREQ=WEEKLY;BYDAY=MO,WE"
              />
              <p className="mt-3 text-xs uppercase tracking-[0.16em] text-forge-steel">
                {value.advancedOverride
                  ? 'Manual RRULE override is active. Unsupported rules stay in advanced mode.'
                  : 'Builder state generates the RRULE automatically. Editing here will switch to manual only when needed.'}
              </p>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}

function inferredUnit(mode: RecurrenceMode): RecurrenceUnit {
  if (mode === 'daily') {
    return 'day'
  }
  if (mode === 'monthly') {
    return 'month'
  }
  return 'week'
}

function unitLabel(unit: RecurrenceUnit) {
  if (unit === 'day') {
    return 'Day'
  }
  if (unit === 'month') {
    return 'Month'
  }
  return 'Week'
}

function withBuilderUpdate(
  current: RecurrenceState,
  startValue: string,
  patch: Partial<RecurrenceState>,
) {
  const next = {
    ...current,
    ...patch,
    advancedOverride: false,
  }
  return {
    ...next,
    advancedRRule: buildRRule(next, startValue) ?? '',
  }
}

function diffMinutes(startValue: string, endValue: string) {
  const start = new Date(startValue)
  const end = new Date(endValue)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0
  }
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
}

function BuilderField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-2">
      <div className="text-[11px] uppercase tracking-[0.24em] text-forge-steel">{label}</div>
      {children}
    </div>
  )
}

function ToggleChip({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      className={`rounded-full border px-3 py-2 text-sm transition ${
        active
          ? 'border-forge-rust bg-forge-rust text-white'
          : 'border-forge-steel/20 bg-white text-forge-ink hover:border-forge-rust/50'
      }`}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function SelectRow({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  disabled?: boolean
}) {
  return (
    <select
      className="rounded-2xl border border-forge-steel/20 bg-white px-3 py-2 text-sm text-forge-ink disabled:cursor-not-allowed disabled:bg-[#f3efe8]"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function RadioRow({
  checked,
  label,
  trailing,
  onChange,
}: {
  checked: boolean
  label: string
  trailing?: React.ReactNode
  onChange: () => void
}) {
  return (
    <label className="flex flex-wrap items-center gap-3 rounded-2xl border border-forge-steel/15 bg-white px-4 py-3 text-sm">
      <input checked={checked} type="radio" name={label} onChange={onChange} />
      <span>{label}</span>
      {trailing}
    </label>
  )
}
