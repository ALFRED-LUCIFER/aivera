'use client';

import {
  AssistantDrawer,
  BulkActionBar,
  Button,
  Checkbox,
  DataTable,
  FilterTabs,
  PreviewBanner,
  PreviewConfirmCard,
  ScoreWithUncertainty,
  SuccessBanner,
  type DataTableColumn,
  type DataTableSort,
} from '@aivera/ui';
import { sample, type SampleRow } from '../domain/sample.ts';
import { useScoreLabels } from './EvidenceSections.tsx';
import { Section, State } from './Section.tsx';

const s = sample.sections;
const tb = sample.table;
const p = sample.preview;
const a = sample.assistant;
const noop = () => {};

function ScoreCell({ backed, upTo }: SampleRow) {
  return <ScoreWithUncertainty backed={backed} upTo={upTo} {...useScoreLabels(true)} />;
}

const columns: DataTableColumn<SampleRow>[] = [
  { id: 'name', header: tb.name, cell: (row) => row.name, sortable: true },
  { id: 'job', header: tb.job, cell: (row) => row.job },
  { id: 'score', header: tb.score, numeric: true, sortable: true, cell: (row) => <ScoreCell {...row} /> },
];
const table = { caption: tb.caption, columns, getRowId: (row: SampleRow) => row.id, emptyMessage: tb.empty };

export type WorkflowProps = {
  rows: SampleRow[];
  sort: DataTableSort;
  onSortChange: (sort: DataTableSort) => void;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  tab: string;
  onTabChange: (tab: string) => void;
  previewOpen: boolean;
  onPreviewOpenChange: (open: boolean) => void;
  onConfirmFails: () => Promise<unknown>;
  bulkOpen: boolean;
  onBulkOpenChange: (open: boolean) => void;
  onConfirmNeverSettles: () => Promise<unknown>;
  sent: boolean;
  onBannerConfirm: () => void;
};

export function WorkflowSections(c: WorkflowProps) {
  return (
    <>
      <Section id="table" title={s.table}>
        <FilterTabs
          label={tb.filter}
          value={c.tab}
          onValueChange={c.onTabChange}
          tabs={[
            { value: 'all', label: tb.tabs.all, count: 3 },
            { value: 'action', label: tb.tabs.action, count: 2 },
            { value: 'round', label: tb.tabs.round, count: 1 },
          ]}
        />
        <BulkActionBar
          label={tb.bulk}
          selectedIds={c.selectedIds}
          selectedLabel={tb.selected(c.selectedIds.length)}
          previewNote={tb.previewNote}
          actions={[{ id: 'request', label: tb.request, preview: (ids) => ({ ids }) }]}
          onPreview={() => c.onBulkOpenChange(true)}
        />
        <State title={tb.states.full}>
          <DataTable
            {...table}
            rows={c.rows}
            sort={c.sort}
            onSortChange={c.onSortChange}
            selection={{
              selectedIds: c.selectedIds,
              onSelectedIdsChange: c.onSelectedIdsChange,
              allLabel: tb.selectAll,
              rowLabel: (row) => `${tb.select} ${row.name}`,
            }}
          />
        </State>
        <State title={tb.states.empty}>
          <DataTable {...table} rows={[]} />
        </State>
        <State title={tb.states.loading}>
          <DataTable {...table} rows={[]} loading loadingLabel={tb.loading} />
        </State>
        <State title={tb.states.error}>
          <DataTable {...table} rows={[]} error={{ message: tb.error, retryLabel: tb.retry, onRetry: noop }} />
        </State>
        <PreviewConfirmCard
          open={c.bulkOpen}
          onOpenChange={c.onBulkOpenChange}
          title={p.bulk}
          consequence={p.bulkBody}
          confirmLabel={p.bulkConfirm}
          pendingLabel={p.bulkPending}
          cancelLabel={p.cancel}
          footer={p.footer}
          errorMessage={p.error}
          closeLabel={p.close}
          onConfirm={c.onConfirmNeverSettles}
          onCancel={noop}
        />
      </Section>

      <Section id="preview" title={s.preview}>
        <div>
          <PreviewConfirmCard
            open={c.previewOpen}
            onOpenChange={c.onPreviewOpenChange}
            trigger={<Button>{p.singleOpen}</Button>}
            title={p.single}
            consequence={p.consequence}
            confirmLabel={p.confirm}
            pendingLabel={p.pending}
            editLabel={p.edit}
            onEdit={noop}
            cancelLabel={p.cancel}
            footer={p.footer}
            errorMessage={p.error}
            closeLabel={p.close}
            onConfirm={c.onConfirmFails}
            onCancel={noop}
          >
            {p.current}
          </PreviewConfirmCard>
        </div>
        {!c.sent && (
          <PreviewBanner
            title={p.bulk}
            confirmLabel={p.bulkConfirm}
            pendingLabel={p.bulkPending}
            cancelLabel={p.cancel}
            footer={p.footer}
            errorMessage={p.error}
            onConfirm={c.onBannerConfirm}
            onCancel={noop}
          >
            {p.bulkBody}
            <Checkbox label={p.followUp} defaultChecked />
          </PreviewBanner>
        )}
        <SuccessBanner>{c.sent ? p.success : null}</SuccessBanner>
      </Section>

      <Section id="assistant" title={s.assistant}>
        <div>
          <AssistantDrawer
            title={a.title}
            context={a.context}
            inputLabel={a.input}
            askLabel={a.ask}
            footer={a.footer}
            closeLabel={a.close}
            onAsk={noop}
            trigger={<Button>{a.open}</Button>}
          >
            <ul className="flex flex-col gap-2">
              {a.suggestions.map((q) => (
                <li key={q}>
                  <Button size="compact">{q}</Button>
                </li>
              ))}
            </ul>
          </AssistantDrawer>
        </div>
      </Section>
    </>
  );
}
