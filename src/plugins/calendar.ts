/** Pure calendar helpers for seasonal (festival) plugin windows. */

/** Format a date as `MM-DD` in local time. */
export function monthDay(now: number | Date): string {
  const date = now instanceof Date ? now : new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

/**
 * Is `MM-DD` inside the inclusive window? Windows may wrap the new year
 * (`12-28` -> `01-03`). String comparison works because both ends are zero
 * padded `MM-DD`.
 */
export function inMonthDayWindow(today: string, start: string, end: string): boolean {
  if (start <= end) return today >= start && today <= end;
  return today >= start || today <= end;
}

export function festivalActive(
  window: { start: string; end: string },
  now: number | Date,
): boolean {
  return inMonthDayWindow(monthDay(now), window.start, window.end);
}
