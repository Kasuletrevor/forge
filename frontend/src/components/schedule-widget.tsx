import { useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'

interface EventData {
  id: string
  title: string
  date: string // ISO date string or simple YYYY-MM-DD
}

interface ScheduleWidgetProps {
  events?: EventData[]
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

export function ScheduleWidget({ events = [] }: ScheduleWidgetProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(new Date())

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1))
  }

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1))
  }

  const handleDayClick = (day: number) => {
    setSelectedDate(new Date(year, month, day))
  }

  const monthName = currentDate.toLocaleString('default', { month: 'long' })
  
  // Format selected date like "WED, MAR 11"
  const selectedDateStr = selectedDate.toLocaleString('default', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).toUpperCase()

  // Find events for selected date
  const selectedIso = selectedDate.toISOString().split('T')[0]
  const dayEvents = events.filter(e => e.date.startsWith(selectedIso))

  const isToday = (d: number) => {
    const today = new Date()
    return d === today.getDate() && month === today.getMonth() && year === today.getFullYear()
  }

  const isSelected = (d: number) => {
    return d === selectedDate.getDate() && month === selectedDate.getMonth() && year === selectedDate.getFullYear()
  }

  return (
    <div className="relative rounded-2xl bg-[#1a232c] p-6 pt-10 text-white font-sans shadow-xl border border-white/5">
      {/* Top Badge */}
      <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-md bg-[#6691a3] px-4 py-1.5 text-sm font-bold tracking-wide text-[#0f171e] shadow-sm">
        YOUR SCHEDULE
      </div>

      {/* Calendar Card */}
      <div className="rounded-xl bg-[#e5e7eb] text-slate-900 overflow-hidden shadow-inner">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#e5e7eb]">
          <button onClick={handlePrevMonth} className="rounded-full bg-slate-900 p-1 text-white hover:bg-slate-700 transition">
            <ChevronLeft className="size-4" />
          </button>
          <div className="font-bold text-[17px]">{monthName}</div>
          <button onClick={handleNextMonth} className="rounded-full bg-slate-900 p-1 text-white hover:bg-slate-700 transition">
            <ChevronRight className="size-4" />
          </button>
        </div>

        {/* Days Header */}
        <div className="grid grid-cols-7 gap-px bg-slate-900/5">
          {DAYS.map(day => (
            <div key={day} className="py-2 text-center text-xs font-semibold text-slate-500 bg-[#e5e7eb]">
              {day}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 gap-px bg-slate-900">
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} className="bg-[#11161d] min-h-[44px]" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const d = i + 1
            const selected = isSelected(d)
            const today = isToday(d)
            return (
              <button
                key={d}
                onClick={() => handleDayClick(d)}
                className={`
                  min-h-[44px] flex items-center justify-center text-[15px] transition-colors
                  ${selected 
                    ? 'bg-[#e5e7eb] text-slate-900 font-bold' 
                    : today
                      ? 'bg-slate-800 text-white font-bold'
                      : 'bg-[#11161d] text-white hover:bg-slate-800'
                  }
                `}
              >
                {d}
              </button>
            )
          })}
          {/* Fill remaining cells if needed */}
          {Array.from({ length: (7 - ((firstDay + daysInMonth) % 7)) % 7 }).map((_, i) => (
            <div key={`empty-end-${i}`} className="bg-[#11161d] min-h-[44px]" />
          ))}
        </div>
      </div>

      {/* Selected Day Info */}
      <div className="mt-8 flex items-center gap-6 px-2">
        <div className="flex items-center gap-2 text-[#469597] font-semibold text-[15px] shrink-0">
          <CalendarIcon className="size-5" />
          <span>{selectedDateStr}</span>
        </div>
        <div className="text-slate-300 text-[15px]">
          {dayEvents.length === 0 ? (
            "Nothing's on the schedule"
          ) : (
            <div className="space-y-1">
              {dayEvents.map(e => (
                <div key={e.id} className="truncate">{e.title}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
