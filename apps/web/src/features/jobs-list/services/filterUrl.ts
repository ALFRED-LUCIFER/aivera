// Keeps a filter in the URL without a server round trip, so reload and Back keep it; '' removes it. Next syncs
// useSearchParams only when the state is not its own. The client filter carries an opaque id, never a name.
export function replaceInUrl(param: 'filter' | 'client', value: string) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(param, value);
  else url.searchParams.delete(param);
  window.history.replaceState(null, '', url);
}
