'use client';

import { useTimeZone, useTranslations } from '@credalent/i18n/react';
import { Button, Card, StatusBadge, ValueBasis, type StatusBadgeStatus } from '@credalent/ui';
import type { CatalogueEvalViewModel, EvalView } from '../domain/catalogueEval.ts';
import { RefusalText } from './CatalogueForms.tsx';

/*
 * The draft's AI eval (AIV-P2-048), from the console spec's catalogue editor layout (operator-console.md); there is no
 * artboard for it. "Review and publish" in the draft banner (AIV-P2-049) is gated by this state, and the server
 * checks it again through `evalAllowsPublish`.
 */

const BADGES: Record<EvalView['status'], StatusBadgeStatus> = {
  not_run: 'informational',
  running: 'informational',
  passed: 'supported',
  failed: 'contradiction',
  stale: 'needsValidation',
  error: 'contradiction',
};

export function CatalogueEval({ eval: model }: { eval: CatalogueEvalViewModel }) {
  const t = useTranslations('ops.catalogue.editor.eval');
  const timeZone = useTimeZone();
  const { view, pending, error, onRun } = model;
  return (
    <Card title={t('title')} level={2}>
      <div className="flex flex-col gap-4">
        {/* A live region, so "Eval passed" or "Eval failed" is announced when the page reloads with the result. */}
        <output className="flex flex-wrap items-center gap-3">
          <StatusBadge status={BADGES[view.status]} label={t(`status.${view.status}`)} />
          {(view.status === 'passed' || view.status === 'failed') && (
            <span className="text-meta text-text-2">{t('ranAt', { at: view.finishedAt, timeZone })}</span>
          )}
        </output>
        {view.status !== 'passed' && view.status !== 'failed' && (
          <p className="text-body text-text">{t(`message.${view.status}`)}</p>
        )}
        {(view.status === 'passed' || view.status === 'failed') && (
          <>
            {view.uncovered.length > 0 && (
              <p className="text-body font-semibold text-text">{t('uncovered', { keys: view.uncovered.join(', ') })}</p>
            )}
            {view.tasks.map(({ task, metrics }) => (
              <section key={task} className="flex flex-col gap-2">
                <h3 className="text-body font-semibold text-text">{t(`tasks.${task}`)}</h3>
                <dl className="flex flex-col gap-1">
                  {metrics.map(({ key, percent }) => (
                    <div key={key} className="flex flex-wrap items-center gap-2">
                      <dt className="text-body text-text-2">{t(`metric.${key}`)}</dt>
                      <dd className="flex items-center gap-2 font-semibold text-text tabular-nums">
                        {t('percent', { value: percent })}
                        <ValueBasis basis="observed" label={t('observed')} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
            {view.failedCases.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-body font-semibold text-text">{t('failedCases')}</h3>
                <ul className="flex flex-wrap gap-2">
                  {view.failedCases.map((id) => (
                    <li key={id} className="font-mono text-meta text-text-2">
                      {id}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        <div>
          <Button onClick={() => void onRun()} disabled={pending || view.status === 'running'}>
            {pending ? t('requesting') : t('run')}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-body font-semibold text-err-text">
            <RefusalText error={error} />
          </p>
        )}
      </div>
    </Card>
  );
}
