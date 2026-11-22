/** 00:05 UTC on the day after `now`: the daily AI token budget counts per UTC day, and a little after midnight is clear of the reset. */
export const budgetResetAt = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5));
