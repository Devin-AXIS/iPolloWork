import { useRef, useState } from 'react'
import { Button, IconButton, Popover, Select, TextField } from '@radix-ui/themes'
import { CalendarIcon, ClockIcon, ChevronLeftIcon, ChevronRightIcon } from '@radix-ui/react-icons'
import { translate as tr, useLocale } from '../i18n'
import { dateKey, parseDate, timestampParts, timestampValue } from './input-values'
import type { ValueInputProps } from './input-controls'

export function TemporalInput({
  field,
  value,
  onChange,
  kind,
}: ValueInputProps & { kind: 'date' | 'time' | 'datetime' | 'daterange' }) {
  const locale = useLocale(),
    today = dateKey(new Date())
  const range = kind === 'daterange',
    datetime = kind === 'datetime',
    timeOnly = kind === 'time'
  const period =
    range && value && typeof value === 'object' ? (value as { start?: string; end?: string }) : {}
  const parts = timestampParts(datetime ? value : undefined)
  const start = range
    ? (period.start ?? '')
    : datetime
      ? parts.date
      : timeOnly
        ? ''
        : String(value ?? '')
  const end = period.end ?? '',
    time = timeOnly ? String(value ?? '') : parts.time
  const [open, setOpen] = useState(false),
    [error, setError] = useState('')
  const [month, setMonth] = useState(() => parseDate(start) ?? new Date())
  const [focused, setFocused] = useState(start || today)
  const calendar = useRef<HTMLDivElement>(null)
  function show(next: boolean) {
    if (next) {
      setMonth(parseDate(start) ?? new Date())
      setFocused(start || today)
      setError('')
    }
    setOpen(next)
  }
  function publish(date: string, clock = time || '00:00') {
    const next = datetime ? timestampValue(date, clock, value) : date
    if (next === undefined) {
      setError(tr('此时间在当前时区不存在，请选择其他时间。'))
      return
    }
    setError('')
    onChange(next)
  }
  function choose(key: string) {
    if (range) {
      if (!start || end) onChange({ start: key, end: '' })
      else {
        onChange({ start: key < start ? key : start, end: key < start ? start : key })
        setOpen(false)
      }
    } else {
      publish(key)
      if (!datetime) setOpen(false)
    }
  }
  function viewMonth(next: Date) {
    setMonth(next)
    setFocused(dateKey(next))
  }
  function moveMonth(delta: number) {
    const next = new Date(month)
    next.setDate(1)
    next.setMonth(next.getMonth() + delta)
    if (next.getFullYear() >= 0 && next.getFullYear() <= 9999) viewMonth(next)
  }
  const first = new Date(month)
  first.setDate(1)
  first.setDate(1 - ((first.getDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_, i) => {
    const day = new Date(first)
    day.setDate(first.getDate() + i)
    return day
  })
  const caption = month.toLocaleDateString(locale, { year: 'numeric', month: 'long' })
  const label = range
    ? start
      ? `${start} → ${end || tr('结束日期')}`
      : tr('选择日期范围')
    : datetime
      ? start
        ? `${start} ${time}`
        : tr('选择日期时间')
      : timeOnly
        ? time || tr('选择时间')
        : start || tr('选择日期')
  return (
    <Popover.Root open={open} onOpenChange={show}>
      <Popover.Trigger>
        <Button
          type="button"
          id={field.id}
          aria-label={field.name}
          color="gray"
          variant="surface"
          className="field-picker-trigger"
          data-empty={timeOnly ? !time : !start}
        >
          {timeOnly ? <ClockIcon /> : <CalendarIcon />}
          <span className="field-picker-summary">{label}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Content
        align="start"
        className="field-date-popover"
        sideOffset={6}
        collisionPadding={12}
        onOpenAutoFocus={(event) => {
          if (!timeOnly) {
            event.preventDefault()
            calendar.current
              ?.querySelector<HTMLButtonElement>(`button[data-day="${focused}"]`)
              ?.focus()
          }
        }}
      >
        {!timeOnly && (
          <>
            <div className="field-calendar-heading">
              <IconButton
                type="button"
                size="1"
                variant="ghost"
                color="gray"
                aria-label={tr('上个月')}
                onClick={() => moveMonth(-1)}
              >
                <ChevronLeftIcon />
              </IconButton>
              <Select.Root
                value={String(month.getMonth())}
                onValueChange={(value) => {
                  const next = new Date(month)
                  next.setDate(1)
                  next.setMonth(Number(value))
                  viewMonth(next)
                }}
              >
                <Select.Trigger variant="ghost" color="gray" aria-label={tr('月份')} />
                <Select.Content position="popper" sideOffset={6}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <Select.Item key={i} value={String(i)}>
                      {new Date(2026, i, 1).toLocaleDateString(locale, { month: 'long' })}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <input
                aria-label={tr('年份')}
                type="number"
                min={0}
                max={9999}
                value={month.getFullYear()}
                data-field-enter="control"
                onChange={(e) => {
                  const year = Number(e.target.value)
                  if (e.target.value && Number.isInteger(year) && year >= 0 && year <= 9999) {
                    const next = new Date(month)
                    next.setDate(1)
                    next.setFullYear(year)
                    viewMonth(next)
                  }
                }}
              />
              <IconButton
                type="button"
                size="1"
                variant="ghost"
                color="gray"
                aria-label={tr('下个月')}
                onClick={() => moveMonth(1)}
              >
                <ChevronRightIcon />
              </IconButton>
            </div>
            <div className="field-calendar-week" aria-hidden="true">
              {days.slice(0, 7).map((day) => (
                <span key={dateKey(day)}>
                  {day.toLocaleDateString(locale, { weekday: 'narrow' })}
                </span>
              ))}
            </div>
            <div className="field-calendar-days" role="group" aria-label={caption} ref={calendar}>
              {days.map((day) => {
                const key = dateKey(day),
                  selected = key === start || (range && key === end)
                return (
                  <button
                    type="button"
                    key={key}
                    data-day={key}
                    data-outside={day.getMonth() !== month.getMonth()}
                    data-range={range && !!start && !!end && key > start && key < end}
                    aria-label={key}
                    aria-pressed={selected}
                    aria-current={key === today ? 'date' : undefined}
                    disabled={!parseDate(key)}
                    tabIndex={key === focused ? 0 : -1}
                    onClick={() => choose(key)}
                    onKeyDown={(e) => {
                      const delta: Record<string, number> = {
                        ArrowLeft: -1,
                        ArrowRight: 1,
                        ArrowUp: -7,
                        ArrowDown: 7,
                        Home: -((day.getDay() + 6) % 7),
                        End: 6 - ((day.getDay() + 6) % 7),
                      }
                      if (!(e.key in delta) && !['PageUp', 'PageDown'].includes(e.key)) return
                      e.preventDefault()
                      e.stopPropagation()
                      const next = new Date(day)
                      if (e.key in delta) next.setDate(day.getDate() + delta[e.key])
                      else {
                        next.setDate(1)
                        next.setMonth(day.getMonth() + (e.key === 'PageUp' ? -1 : 1))
                        const last = new Date(next)
                        last.setMonth(last.getMonth() + 1, 0)
                        next.setDate(Math.min(day.getDate(), last.getDate()))
                      }
                      const nextKey = dateKey(next)
                      if (!parseDate(nextKey)) return
                      setMonth(next)
                      setFocused(nextKey)
                      requestAnimationFrame(() =>
                        calendar.current
                          ?.querySelector<HTMLButtonElement>(`button[data-day="${nextKey}"]`)
                          ?.focus(),
                      )
                    }}
                  >
                    {day.getDate()}
                  </button>
                )
              })}
            </div>
            <div className="field-date-inputs">
              <TextField.Root
                type="date"
                aria-label={range ? tr('{0}开始日期', { 0: field.name }) : field.name}
                value={start}
                max={range && end ? end : '9999-12-31'}
                onChange={(e) => {
                  range ? onChange({ start: e.target.value, end }) : publish(e.target.value)
                  const next = parseDate(e.target.value)
                  if (next) viewMonth(next)
                }}
              />
              {range && (
                <TextField.Root
                  type="date"
                  aria-label={tr('{0}结束日期', { 0: field.name })}
                  value={end}
                  min={start || undefined}
                  max="9999-12-31"
                  onChange={(e) => onChange({ start, end: e.target.value })}
                />
              )}
            </div>
          </>
        )}
        {(datetime || timeOnly) && (
          <TextField.Root
            type="time"
            aria-label={timeOnly ? field.name : tr('{0}时间', { 0: field.name })}
            value={time}
            step={timeOnly ? '1' : '0.001'}
            onChange={(e) =>
              timeOnly ? onChange(e.target.value) : publish(start || today, e.target.value)
            }
          >
            <TextField.Slot>
              <ClockIcon />
            </TextField.Slot>
          </TextField.Root>
        )}
        {datetime && (
          <small className="form-hint">
            {tr('本地时区：{0}', { 0: Intl.DateTimeFormat().resolvedOptions().timeZone })}
          </small>
        )}
        {error && <small role="alert">{error}</small>}
        <div className="field-input-footer">
          <Button
            type="button"
            size="1"
            color="gray"
            variant="ghost"
            onClick={() => {
              onChange('')
              setError('')
              setOpen(false)
            }}
          >
            {tr('清除')}
          </Button>
          {!timeOnly && (
            <Button
              type="button"
              size="1"
              color="gray"
              variant="ghost"
              onClick={() => {
                setMonth(new Date())
                setFocused(today)
                choose(today)
              }}
            >
              {tr('今天')}
            </Button>
          )}
          <Button type="button" size="1" color="gray" variant="soft" onClick={() => setOpen(false)}>
            {tr('完成')}
          </Button>
        </div>
      </Popover.Content>
    </Popover.Root>
  )
}
