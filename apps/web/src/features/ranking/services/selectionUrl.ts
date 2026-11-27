// Mirrors the ranking's selection (comma-separated ids) to the URL without a server round trip, as the Jobs list keeps
// its filter (filterUrl.ts), so a reload or a shared link restores it. The ids are opaque application ids (AGENTS.md 1.2).
export function replaceSelectedInUrl(selected: string) {
  const url = new URL(window.location.href);
  if ((url.searchParams.get('selected') ?? '') === selected) return;
  if (selected) url.searchParams.set('selected', selected);
  else url.searchParams.delete('selected');
  window.history.replaceState(null, '', url);
}
