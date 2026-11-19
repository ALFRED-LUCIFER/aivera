// shortcut: no feature flag is on yet; the flag service supplies this set when it ships. Read by both sides' pages.
export const enabledFlags: ReadonlySet<string> = new Set();
