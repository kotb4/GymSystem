const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function dateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayKey(): string {
  return dateKey();
}

export function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_RE.test(value)) return false;
  const parts = value.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  );
}

export function parseDateKey(key: string): Date {
  const parts = key.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

export function addDaysKey(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function calcSubscriptionEndDate(startKey: string, durationDays: number): string {
  return addDaysKey(startKey, durationDays - 1);
}

export function diffDaysKeys(fromKey: string, toKey: string): number {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  const utcFrom = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const utcTo = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((utcTo - utcFrom) / 86_400_000);
}

export function nowStamp(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function stampAfterSeconds(seconds: number): string {
  return nowStamp(new Date(Date.now() + seconds * 1000));
}

export function stampToDateKey(stamp: string): string {
  return stamp.slice(0, 10);
}

function parseStamp(stamp: string): Date {
  return new Date(stamp.replace(" ", "T"));
}

export function secondsBetweenStamps(laterStamp: string, earlierStamp: string): number {
  const later = parseStamp(laterStamp).getTime();
  const earlier = parseStamp(earlierStamp).getTime();
  return Math.max(0, Math.floor((later - earlier) / 1000));
}
