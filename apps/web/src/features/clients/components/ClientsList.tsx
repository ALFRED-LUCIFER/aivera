'use client';

import type { Messages } from '@aivera/i18n';
import { useTranslations } from '@aivera/i18n/react';
import { Button, DataTable, Dialog, DialogClose, Input, Label, SuccessBanner, type DataTableColumn } from '@aivera/ui';
import type { ReactNode } from 'react';
import { CLIENT_NAME_MAX, type ClientRow, type ClientsView } from '../domain/clients.ts';

type Row = ClientRow & { label: ReactNode; jobs: ReactNode; actions: ReactNode };

const cells: (Omit<DataTableColumn<Row>, 'header'> & { id: keyof Messages['clients']['columns'] })[] = [
  { id: 'name', cell: (row) => row.label },
  { id: 'openJobs', cell: (row) => row.jobs },
  { id: 'actions', cell: (row) => row.actions },
];

/**
 * An agency's clients (AIV-P1-056): each with its open jobs, "Add client", rename, and archive after confirming.
 * Archived clients stay listed, marked, so their jobs keep resolving.
 */
export function ClientsList({ view }: { view: ClientsView }) {
  const t = useTranslations('clients');
  const fieldError = view.error === 'name' || view.error === 'exists' ? view.error : null;
  const columns = cells.map((column) => ({ ...column, header: t(`columns.${column.id}`) }));
  // The cells' content is built here, as elements, so the column definitions stay module-level and stable.
  const rows: Row[] = view.rows.map((row) => ({
    ...row,
    label: (
      <>
        <span className="font-semibold text-text">{row.name}</span>
        {row.archived && <span className="ms-2 text-meta text-text-2">{t('archived')}</span>}
      </>
    ),
    jobs: t('openJobs', { count: row.openJobs }),
    actions: !row.archived && (
      <span className="flex flex-wrap gap-2">
        <Button variant="ghost" aria-label={t('renameFor', { name: row.name })} onClick={() => view.onRenameOpen(row)}>
          {t('rename')}
        </Button>
        <Button
          variant="ghost"
          aria-label={t('archiveFor', { name: row.name })}
          onClick={() => view.onArchiveOpen(row)}
        >
          {t('archive')}
        </Button>
      </span>
    ),
  }));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SuccessBanner>{view.done && t(`done.${view.done}`)}</SuccessBanner>
      {view.error === 'failed' && (
        <p role="alert" className="text-body font-semibold text-err-text">
          {t('errors.failed')}
        </p>
      )}
      <form
        noValidate
        className="flex flex-col gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          void view.onAdd();
        }}
      >
        <Label htmlFor="client-name">{t('name')}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="client-name"
            className="max-w-sm"
            maxLength={CLIENT_NAME_MAX}
            value={view.name}
            onChange={(event) => view.onNameChange(event.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'client-name-error' : undefined}
          />
          <Button type="submit" variant="primary" disabled={view.pending}>
            {t('add')}
          </Button>
        </div>
        {fieldError && (
          <p id="client-name-error" role="alert" className="text-meta font-semibold text-err-text">
            {t(`errors.${fieldError}`)}
          </p>
        )}
      </form>
      <DataTable
        caption={t('caption')}
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        emptyMessage={t('empty')}
      />

      <Dialog
        open={view.renaming !== null}
        onOpenChange={(open) => !open && view.onClose()}
        title={t('renameTitle')}
        closeLabel={t('close')}
      >
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void view.onRename();
          }}
        >
          <Label htmlFor="client-rename">{t('name')}</Label>
          <Input
            id="client-rename"
            maxLength={CLIENT_NAME_MAX}
            value={view.renaming?.name ?? ''}
            onChange={(event) => view.onRenameChange(event.target.value)}
            aria-invalid={view.renaming?.error ? true : undefined}
            aria-describedby={view.renaming?.error ? 'client-rename-error' : undefined}
          />
          {view.renaming?.error && (
            <p id="client-rename-error" role="alert" className="text-meta font-semibold text-err-text">
              {t(`errors.${view.renaming.error}`)}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button>{t('cancel')}</Button>
            </DialogClose>
            <Button type="submit" variant="primary" disabled={view.pending}>
              {t('save')}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={view.archiving !== null}
        onOpenChange={(open) => !open && view.onClose()}
        title={t('archiveTitle', { name: view.archiving?.name ?? '' })}
        description={t('archiveBody')}
        closeLabel={t('close')}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button>{t('cancel')}</Button>
          </DialogClose>
          <Button onClick={() => void view.onArchive()} disabled={view.pending}>
            {t('archive')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
