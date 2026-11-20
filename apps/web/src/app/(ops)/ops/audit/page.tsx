import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { AuditLog } from '@/features/ops/components/AuditLog.tsx';
import { auditHref, auditParamsSchema, auditQuery, toEntryQuery } from '@/features/ops/domain/audit.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { listPlatformAudit, platformOperator } from '@/server/operator';

export async function generateMetadata(): Promise<Metadata> {
  await platformOperator();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: t('ops.audit.title') };
}

// The platform audit log (AIV-P2-054, ADR-012 point 8). Loading and error states: loading.tsx and error.tsx beside this
// page. Reading the log is platform metadata and is not itself audited.
export default async function AuditPage({ searchParams }: PageProps<'/ops/audit'>) {
  await platformOperator();
  const raw = await searchParams;
  const params = auditParamsSchema.parse(raw);
  // The parsed parameters keep their raw values, so a count that differs means an empty (an unset GET form field),
  // repeated, malformed or unknown one: drop it, so the URL carries only the filters that are set.
  if (Object.keys(raw).length !== new URLSearchParams(auditQuery(params)).size) redirect(auditHref(params) as Route);
  const [t, { rows, nextCursor, operators }] = await Promise.all([
    getTranslations(defaultLocale, defaultTimeZone),
    listPlatformAudit(toEntryQuery(params)),
  ]);
  return (
    <>
      <PageHeader title={t('ops.audit.title')} description={t('ops.audit.description')} />
      <AuditLog
        filters={{ params, operators }}
        table={{
          status: 'ready',
          rows,
          filtered: Object.values(params).some(Boolean),
          // shortcut: a log of exactly 50, 100… entries offers "Next page" to an empty last page (keyset paging has no
          // count); add a look-ahead row to the read when operators find it confusing.
          nextHref: nextCursor && auditHref({ ...params, cursor: nextCursor }),
        }}
      />
    </>
  );
}
