import { useTranslations } from '@aivera/i18n/react';
import { ROLES } from '@aivera/workspaces';
import { Button, DataTable, Dialog, Select, type DataTableColumn } from '@aivera/ui';
import {
  JOB_SCOPED,
  jobsCell,
  type ManageState,
  type MemberDialog,
  type MemberRow,
  type Option,
} from '../domain/members.ts';
import type { ReactNode } from 'react';
import { JobPicker } from './JobPicker.tsx';

type MembersTableProps = {
  rows: MemberRow[];
  jobs: Option[];
  clients: Option[] | null;
  action: (form: FormData) => void;
  state: ManageState;
  pending: boolean;
  dialog: MemberDialog | null;
  onOpenDialog: (dialog: MemberDialog) => void;
  onCloseDialog: () => void;
};

type RowActions = Pick<MembersTableProps, 'action' | 'pending' | 'onOpenDialog'>;

const Hidden = ({ name, value }: { name: string; value: string }) => <input type="hidden" name={name} value={value} />;

function PersonCell({ row }: { row: MemberRow }) {
  const detail = [row.name, row.title].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-col">
      <span className="text-text">{row.email}</span>
      {detail && <span className="text-meta text-text-2">{detail}</span>}
    </div>
  );
}

function RoleCell({ row }: { row: MemberRow }) {
  return useTranslations('members')(`roles.${row.role}`);
}

function JobsCell({ row }: { row: MemberRow }) {
  const t = useTranslations('members.table');
  return jobsCell(row, { all: t('allJobs'), none: t('noJobs') });
}

function StatusCell({ row }: { row: MemberRow }) {
  return useTranslations('members')(`status.${row.status}`);
}

type Row = MemberRow & { actions: ReactNode };

// Module-level cell renderers (stable across renders); the component adds the translated headers.
const cells: (Omit<DataTableColumn<Row>, 'header'> & { id: 'person' | 'role' | 'jobs' | 'status' | 'actions' })[] = [
  { id: 'person', cell: (row) => <PersonCell row={row} /> },
  { id: 'role', cell: (row) => <RoleCell row={row} /> },
  { id: 'jobs', cell: (row) => <JobsCell row={row} /> },
  { id: 'status', cell: (row) => <StatusCell row={row} /> },
  { id: 'actions', cell: (row) => row.actions },
];

function ActionsCell({ row, action, pending, onOpenDialog }: RowActions & { row: MemberRow }) {
  const t = useTranslations('members');
  if (row.kind === 'invitation')
    return (
      <form action={action}>
        <Hidden name="intent" value="revoke" />
        <Hidden name="invitationId" value={row.id} />
        <Button
          type="submit"
          size="compact"
          disabled={pending}
          aria-label={t('actions.revokeFor', { email: row.email })}
        >
          {t('actions.revoke')}
        </Button>
      </form>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={action} className="flex items-center gap-2">
        <Hidden name="intent" value="role" />
        <Hidden name="userId" value={row.id} />
        <Select name="role" defaultValue={row.role} aria-label={t('actions.roleFor', { email: row.email })}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </Select>
        <Button type="submit" size="compact" disabled={pending}>
          {t('actions.changeRole')}
        </Button>
      </form>
      {JOB_SCOPED.includes(row.role) && (
        <Button
          size="compact"
          aria-label={t('actions.editJobsFor', { email: row.email })}
          onClick={() => onOpenDialog({ kind: 'jobs', id: row.id })}
        >
          {t('actions.editJobs')}
        </Button>
      )}
      {!row.self && (
        <Button
          size="compact"
          aria-label={t('actions.removeFor', { email: row.email })}
          onClick={() => onOpenDialog({ kind: 'remove', id: row.id })}
        >
          {t('actions.remove')}
        </Button>
      )}
    </div>
  );
}

/**
 * Members and open invitations, with a "Jobs" column ("All jobs", or the job and client names). Each row changes the
 * member's role, edits a hiring owner's or interviewer's jobs, removes the member, or revokes the invitation.
 */
export function MembersTable(props: MembersTableProps) {
  const { rows, jobs, clients, action, state, pending, dialog, onOpenDialog, onCloseDialog } = props;
  const t = useTranslations('members');
  const open = dialog && rows.find((r) => r.id === dialog.id);
  const columns = cells.map((column) => ({ ...column, header: t(`table.${column.id}`) }));
  const withActions = rows.map((row) => ({
    ...row,
    actions: <ActionsCell row={row} action={action} pending={pending} onOpenDialog={onOpenDialog} />,
  }));
  const error = state.error && (
    <p role="alert" className="text-body text-err-text">
      {t(`errors.${state.error}`)}
    </p>
  );
  return (
    <section aria-labelledby="members-title" className="flex flex-col gap-3">
      <h2 id="members-title" className="font-display text-section text-text">
        {t('table.title')}
      </h2>
      {!dialog && error}
      <DataTable
        caption={t('table.caption')}
        columns={columns}
        rows={withActions}
        getRowId={(row) => row.id}
        emptyMessage={t('table.empty')}
      />
      {open && (
        <Dialog
          open
          onOpenChange={(next) => !next && onCloseDialog()}
          closeLabel={t('actions.close')}
          title={t(dialog.kind === 'jobs' ? 'jobsDialog.title' : 'removeDialog.title', { email: open.email })}
          description={dialog.kind === 'remove' ? t('removeDialog.body') : undefined}
        >
          <form action={action} className="mt-4 flex flex-col gap-4">
            <Hidden name="intent" value={dialog.kind} />
            <Hidden name="userId" value={open.id} />
            {dialog.kind === 'jobs' && (
              <JobPicker jobs={jobs} clients={clients} defaultJobIds={open.jobIds} defaultClientIds={open.clientIds} />
            )}
            {error}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={onCloseDialog}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {t(dialog.kind === 'jobs' ? 'jobsDialog.save' : 'removeDialog.confirm')}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
