import { useState } from 'react';
import { rows, type SampleRow } from '../domain/sample.ts';
import { applyTheme } from '../services/dom.ts';

type GalleryTheme = 'light' | 'dark';
// The shape of @credalent/ui's DataTableSort; hooks/ may not import the UI package (ADR-003).
type DataTableSort = { columnId: string; direction: 'ascending' | 'descending' };

const byColumn = (sort: DataTableSort) => (a: SampleRow, b: SampleRow) => {
  const key = sort.columnId === 'score' ? 'backed' : 'name';
  const order = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
  return sort.direction === 'ascending' ? order : -order;
};

/** Demo state only: confirms never change anything; one always fails and one never settles, to show those states. */
export function useGalleryController() {
  const [theme, setTheme] = useState<GalleryTheme>('light');
  const [sort, setSort] = useState<DataTableSort>({ columnId: 'score', direction: 'descending' });
  const [selectedIds, setSelectedIds] = useState<string[]>(['c1', 'c2']);
  const [tab, setTab] = useState('all');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);
  return {
    theme,
    onThemeChange: (value: string) => {
      const next: GalleryTheme = value === 'dark' ? 'dark' : 'light';
      setTheme(next);
      applyTheme(next);
    },
    rows: rows.toSorted(byColumn(sort)),
    sort,
    onSortChange: setSort,
    selectedIds,
    onSelectedIdsChange: setSelectedIds,
    tab,
    onTabChange: setTab,
    previewOpen,
    onPreviewOpenChange: setPreviewOpen,
    // Fails after a beat, so the pending state is painted first (as on a real network) and focus fix-up can be checked.
    onConfirmFails: () =>
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('gallery: confirm always fails here')), 300)),
    bulkOpen,
    onBulkOpenChange: setBulkOpen,
    onConfirmNeverSettles: () => new Promise<never>(() => {}),
    sent,
    onBannerConfirm: () => setSent(true),
    toastOpen,
    onToastOpenChange: setToastOpen,
  };
}
