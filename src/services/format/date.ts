const fullFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const shortFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  day: "numeric",
  month: "long",
});

export function formatTime12(input: Date | string | number | null | undefined): string {
  if (!input) return "—";
  let hours = 0;
  let minutes = 0;

  if (input instanceof Date) {
    if (isNaN(input.getTime())) return "—";
    hours = input.getHours();
    minutes = input.getMinutes();
  } else if (typeof input === "number") {
    const d = new Date(input);
    if (isNaN(d.getTime())) return "—";
    hours = d.getHours();
    minutes = d.getMinutes();
  } else if (typeof input === "string") {
    const str = input.trim();
    const timeMatch = str.match(/(?:^|\s|T)(\d{1,2}):(\d{2})(?::\d{2})?/);
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      minutes = parseInt(timeMatch[2], 10);
    } else {
      const d = new Date(str);
      if (isNaN(d.getTime())) return str;
      hours = d.getHours();
      minutes = d.getMinutes();
    }
  }

  const period = hours >= 12 ? "م" : "ص";
  let h12 = hours % 12;
  if (h12 === 0) h12 = 12;
  const mStr = minutes.toString().padStart(2, "0");
  return `${h12}:${mStr} ${period}`;
}

const weekdayFmt = new Intl.DateTimeFormat("ar-EG", { weekday: "long" });

export const formatDate = (d: Date) => fullFmt.format(d);
export const formatDateShort = (d: Date) => shortFmt.format(d);
export const formatTime = (d: Date | string | number | null | undefined) => formatTime12(d);
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
