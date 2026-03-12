import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu'
import { Palette } from 'lucide-react'

interface ColorPickerProps {
  value: string
  onChange: (value: string) => void
  label?: string
}

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#8dc63f', '#22c55e', '#10b981',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#d946ef', '#ec4899', '#f43f5e', '#64748b', '#78716c', '#71717a', '#737373', '#52525b',
  '#8a7d68', '#469597', '#6691a3', '#161e27', '#25211c', '#332b24', '#c58f80', '#8f3424'
]

export function ColorPicker({ value, onChange, label }: ColorPickerProps) {
  return (
    <label className="block space-y-2 text-sm font-medium text-forge-night/80">
      {label && <span>{label}</span>}
      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-10 w-full max-w-[12rem] items-center gap-2 rounded-[14px] border border-forge-steel/30 bg-white px-3 shadow-sm hover:border-forge-steel/50 transition-colors"
            >
              <div 
                className="size-5 rounded-full border border-black/10 shadow-inner"
                style={{ backgroundColor: value || '#8a7d68' }}
              />
              <span className="font-mono text-xs text-forge-night/70 flex-1 text-left">
                {value || '#8a7d68'}
              </span>
              <Palette className="size-4 text-forge-steel" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64 p-3 rounded-2xl" align="start">
            <div className="mb-2 text-xs font-semibold text-forge-night/70">Theme Colors</div>
            <div className="grid grid-cols-8 gap-1.5">
              {PRESET_COLORS.map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={(e) => { e.preventDefault(); onChange(color) }}
                  className={`size-6 rounded-full border border-black/10 shadow-sm hover:scale-110 transition-transform ${value === color ? 'ring-2 ring-forge-night ring-offset-1' : ''}`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-forge-steel/20">
              <label className="text-xs font-medium text-forge-night/70 flex items-center gap-2">
                Custom Hex
                <input
                  type="text"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  className="flex-1 rounded-md border border-forge-steel/30 px-2 py-1 text-xs font-mono uppercase focus:border-forge-night focus:outline-none"
                  placeholder="#000000"
                  onClick={(e) => e.stopPropagation()} // Prevent dropdown close when typing
                />
              </label>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </label>
  )
}
