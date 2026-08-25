const fullFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const shortFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  day: "numeric",
  month: "long",
});

const timeFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  hour: "numeric",
  minute: "2-digit",
});

const weekdayFmt = new Intl.DateTimeFormat("ar-EG", { weekday: "long" });

export const formatDate = (d: Date) => fullFmt.format(d);
export const formatDateShort = (d: Date) => shortFmt.format(d);
export const formatTime = (d: Date) => timeFmt.format(d);
export const formatWeekday = (d: Date) => weekdayFmt.format(d);

export const formatFullHeading = (d: Date) =>
  `${formatWeekday(d)}، ${formatDate(d)}`;

const DAY = 86_400_000;

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function daysUntil(date: Date): number {
  return Math.round((startOfDay(date).getTime() - startOfDay(new Date()).getTime()) / DAY);
}

export function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

export function pluralDaysPhrase(n: number): string {
  if (n === 1) return "يوم واحد";
  if (n === 2) return "يومين";
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يومًا`;
}

export function formatRemaining(days: number): string {
  if (days < 0) return "منتهي";
  if (days === 0) return "ينتهي اليوم";
  return `متبقي ${pluralDaysPhrase(days)}`;
}

export function formatLastVisit(date: Date): string {
  const diff = Math.round((startOfDay(new Date()).getTime() - startOfDay(date).getTime()) / DAY);
  if (diff <= 0) return `اليوم • ${formatTime(date)}`;
  if (diff === 1) return `أمس • ${formatTime(date)}`;
  return `منذ ${pluralDaysPhrase(diff)}`;
}
