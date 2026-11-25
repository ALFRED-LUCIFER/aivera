// Keeps the selection in the URL without a server round trip, as the Jobs list keeps its filter (filterUrl.ts): Next
// syncs useSearchParams from it. The ids are opaque application ids (AGENTS.md 1.2).
export function replaceSelectedInUrl(ids: string[]) {
  const url = new URL(window.location.href);
  if (ids.length === 0) url.searchParams.delete('selected');
  else url.searchParams.set('selected', ids.join(','));
  window.history.replaceState(null, '', url);
}
