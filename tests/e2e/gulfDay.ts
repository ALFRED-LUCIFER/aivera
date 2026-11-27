import { defaultTimeZone } from '@credalent/i18n';

// AIV-P1-149: seed.ts plans the demo interviews on Gulf days counted from its run, and the app labels them from the
// Gulf day it is read on ("Today, 14:00", "Scorecard due, 2 days"). A run that seeds before Gulf midnight and asserts
// after it must expect the next day's labels, so the specs ask here instead of hard-coding the seed day's.

const day = new Intl.DateTimeFormat('en-CA', {
  timeZone: defaultTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
/** The Gulf calendar day of an instant, as that date's UTC midnight, so two days subtract. */
const gulfDay = (at: Date) => Date.parse(day.format(at));

/** `time` in the Gulf (UTC+4), `days` from `from`'s day there. */
export const gulfTime = (from: Date, days: number, time: string) =>
  new Date(`${new Date(gulfDay(from) + days * 86_400_000).toISOString().slice(0, 10)}T${time}:00+04:00`);

// The app's date format: `interviews.when.at` in the en-AE locale (packages/i18n).
const dayAndMonth = new Intl.DateTimeFormat('en-AE', { timeZone: defaultTimeZone, day: 'numeric', month: 'short' });

/**
 * What the app says at `now` about two interviews seed.ts planned at `seededAt`: Daniel Novak's at 14:00 that Gulf day
 * (the "When" of the list and the scorecard), and Layla Haddad's two Gulf days before it (the list's action).
 */
export function seededInterviewLabels(
  now = new Date(),
  // Set by seed.ts in Playwright's global setup, which the workers inherit.
  seededAt = new Date(process.env['E2E_SEEDED_AT'] ?? ''),
) {
  const daysOn = (gulfDay(now) - gulfDay(seededAt)) / 86_400_000;
  return {
    daniel: `${daysOn === 0 ? 'Today' : dayAndMonth.format(seededAt)}, 14:00`,
    layla: `Scorecard due, ${2 + daysOn} days`,
  };
}
