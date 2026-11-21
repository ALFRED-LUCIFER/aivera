'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Checkbox, Dialog, Input, Label, RadioGroup, Textarea } from '@credalent/ui';
import type { FormEvent, ReactNode } from 'react';
import type { EditorField, EditorViewModel, Refusal } from '../domain/catalogueEditor.ts';

/** A refusal in words: the rule it broke, never the refused text. */
export function RefusalText({ error }: { error: Refusal }) {
  const t = useTranslations('ops.catalogue.editor.errors');
  if (error.error === 'stale') return error.by ? t('stale', { name: error.by }) : t('staleUnknown');
  if (error.error === 'invalid')
    return t(error.field === 'key' || error.field === 'starters' ? `invalid.${error.field}` : 'invalid.other');
  return t(error.error);
}

const fieldId = (field: EditorField) => `catalogue-${field}`;
const errorId = (field: EditorField) => `catalogue-${field}-error`;

/** A labelled field with its hint and, when the save was refused for it, the message under it. */
function Field({
  field,
  label,
  hint,
  error,
  children,
}: {
  field: EditorField;
  label: string;
  hint?: string;
  error: Refusal | null;
  children: (aria: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
}) {
  const refused = error?.field === field;
  const describedBy = [hint && `${fieldId(field)}-hint`, refused && errorId(field)].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={fieldId(field)}>{label}</Label>
      {children({
        id: fieldId(field),
        ...(refused && { 'aria-invalid': true as const }),
        ...(describedBy && { 'aria-describedby': describedBy }),
      })}
      {hint && (
        <p id={`${fieldId(field)}-hint`} className="text-meta text-text-2">
          {hint}
        </p>
      )}
      {refused && error && (
        <p id={errorId(field)} role="alert" className="text-meta font-semibold text-err-text">
          <RefusalText error={error} />
        </p>
      )}
    </div>
  );
}

const FORM_FIELDS: readonly (EditorField | undefined)[] = ['key', 'label', 'name', 'meaning', 'evidence', 'levels'];

/** The refusal of the whole form (stale, failed) when it belongs to no field shown; Reload for a stale draft. */
function FormRefusal({ view, shown }: { view: EditorViewModel; shown: readonly (EditorField | undefined)[] }) {
  const t = useTranslations('ops.catalogue.editor');
  const { error } = view;
  if (!error || (error.field && shown.includes(error.field))) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-body font-semibold text-err-text">
      <RefusalText error={error} />
      {error.error === 'stale' && <Button onClick={view.onReload}>{t('reload')}</Button>}
    </div>
  );
}

function Actions({ view }: { view: EditorViewModel }) {
  const t = useTranslations('ops.catalogue.editor');
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" variant="primary" disabled={view.pending}>
        {view.pending ? t('saving') : t('save')}
      </Button>
      <Button onClick={view.onClose}>{t('cancel')}</Button>
    </div>
  );
}

const submit = (view: EditorViewModel) => (event: FormEvent) => {
  event.preventDefault();
  void view.onSave();
};

/** Add a pack, or edit its label (and its key while it is new in the draft). */
export function PackFormDialog({ view }: { view: EditorViewModel }) {
  const t = useTranslations('ops.catalogue.editor');
  const form = view.packForm;
  return (
    <Dialog
      open={form !== null}
      onOpenChange={(open) => !open && view.onClose()}
      title={form?.previousKey ? t('editPack') : t('addPack')}
      closeLabel={t('close')}
    >
      {form && (
        <form noValidate className="flex flex-col gap-4" onSubmit={submit(view)}>
          <Field
            field="key"
            label={t('fields.key')}
            hint={form.keyEditable ? t('fields.keyHint') : t('fields.keyFixed')}
            error={view.error}
          >
            {(aria) => (
              <Input
                {...aria}
                autoComplete="off"
                spellCheck={false}
                readOnly={!form.keyEditable}
                value={form.key}
                onChange={(event) => view.onPackChange({ key: event.target.value })}
              />
            )}
          </Field>
          <Field field="label" label={t('fields.label')} error={view.error}>
            {(aria) => (
              <Input
                {...aria}
                maxLength={120}
                value={form.label}
                onChange={(event) => view.onPackChange({ label: event.target.value })}
              />
            )}
          </Field>
          <FormRefusal view={view} shown={FORM_FIELDS} />
          <Actions view={view} />
        </form>
      )}
    </Dialog>
  );
}

const JOB_TYPE_FIELDS: readonly (EditorField | undefined)[] = [...FORM_FIELDS, 'starters', 'position'];

/** Add a job type, or edit its texts, starters and place (AIV-P2-047); its key is fixed once saved. */
export function JobTypeFormDialog({ view }: { view: EditorViewModel }) {
  const t = useTranslations('ops.catalogue.editor');
  const form = view.jobTypeForm;
  const startersRefused = view.error?.field === 'starters';
  return (
    <Dialog
      open={form !== null}
      onOpenChange={(open) => !open && view.onClose()}
      title={form?.adding ? t('addJobType') : t('editJobType')}
      closeLabel={t('close')}
      className="max-w-2xl"
    >
      {form && (
        <form noValidate className="flex flex-col gap-4" onSubmit={submit(view)}>
          <Field
            field="key"
            label={t('fields.key')}
            hint={form.adding ? t('fields.keyHint') : t('fields.keyFixed')}
            error={view.error}
          >
            {(aria) => (
              <Input
                {...aria}
                autoComplete="off"
                spellCheck={false}
                readOnly={!form.adding}
                value={form.key}
                onChange={(event) => view.onJobTypeChange({ key: event.target.value })}
              />
            )}
          </Field>
          <Field field="label" label={t('fields.label')} error={view.error}>
            {(aria) => (
              <Input
                {...aria}
                maxLength={120}
                value={form.label}
                onChange={(event) => view.onJobTypeChange({ label: event.target.value })}
              />
            )}
          </Field>
          <Field field="evidence" label={t('fields.evidence')} error={view.error}>
            {(aria) => (
              <Textarea
                {...aria}
                rows={2}
                maxLength={1000}
                value={form.evidence}
                onChange={(event) => view.onJobTypeChange({ evidence: event.target.value })}
              />
            )}
          </Field>
          <fieldset
            className="flex flex-col gap-2"
            aria-describedby={startersRefused ? errorId('starters') : undefined}
          >
            <legend className="mb-1 text-body font-semibold text-text">{t('fields.starters')}</legend>
            {form.starters.map((starter, i) => (
              <div key={i} className="flex flex-col gap-1">
                <Label htmlFor={`catalogue-starter-${i}`}>{t('fields.starter', { n: i + 1 })}</Label>
                <Input
                  id={`catalogue-starter-${i}`}
                  maxLength={200}
                  aria-invalid={startersRefused || undefined}
                  value={starter}
                  onChange={(event) =>
                    view.onJobTypeChange({ starters: form.starters.map((s, j) => (j === i ? event.target.value : s)) })
                  }
                />
              </div>
            ))}
            {startersRefused && view.error && (
              <p id={errorId('starters')} role="alert" className="text-meta font-semibold text-err-text">
                <RefusalText error={view.error} />
              </p>
            )}
          </fieldset>
          <Field
            field="position"
            label={t('fields.position')}
            hint={t('fields.positionHint', { count: view.draft.jobTypes.length })}
            error={view.error}
          >
            {(aria) => (
              <Input
                {...aria}
                type="number"
                inputMode="numeric"
                min={1}
                className="max-w-32"
                value={Number.isNaN(form.position) ? '' : form.position}
                onChange={(event) => view.onJobTypeChange({ position: event.target.valueAsNumber })}
              />
            )}
          </Field>
          <FormRefusal view={view} shown={JOB_TYPE_FIELDS} />
          <Actions view={view} />
        </form>
      )}
    </Dialog>
  );
}

const LEVELS = [1, 3, 5] as const;
const COMPETENCY_FIELDS: readonly (EditorField | undefined)[] = [...FORM_FIELDS, 'appliesTo', 'core'];

const TITLES = {
  competency: { add: 'addCompetency', edit: 'editCompetency' },
  hint: { add: 'addHint', edit: 'editHint' },
} as const;

/**
 * Add or edit a pack competency, or a regional hint (a form with a region: no core): always Desirable; the fairness
 * check's message goes under the field it names.
 */
export function CompetencyFormDialog({ view }: { view: EditorViewModel }) {
  const t = useTranslations('ops.catalogue.editor');
  const form = view.competencyForm;
  const isHint = typeof form?.region === 'string';
  const jobTypeGroup = (list: 'appliesTo' | 'core', legend: string, hint?: string) => (
    <fieldset className="flex flex-col" aria-describedby={view.error?.field === list ? errorId(list) : undefined}>
      <legend className="mb-1 text-body font-semibold text-text">{legend}</legend>
      {hint && <p className="text-meta text-text-2">{hint}</p>}
      <div className="grid sm:grid-cols-2">
        {view.draft.jobTypes.map((jobType) => (
          <Checkbox
            key={jobType.key}
            label={jobType.label}
            checked={form?.[list].includes(jobType.key) ?? false}
            onChange={() => view.onToggleJobType(list, jobType.key)}
          />
        ))}
      </div>
      {view.error?.field === list && (
        <p id={errorId(list)} role="alert" className="text-meta font-semibold text-err-text">
          <RefusalText error={view.error} />
        </p>
      )}
    </fieldset>
  );
  return (
    <Dialog
      open={form !== null}
      onOpenChange={(open) => !open && view.onClose()}
      title={t(TITLES[isHint ? 'hint' : 'competency'][form?.position === null ? 'add' : 'edit'])}
      closeLabel={t('close')}
      className="max-w-2xl"
    >
      {form && (
        <form noValidate className="flex flex-col gap-4" onSubmit={submit(view)}>
          <Field field="name" label={t('fields.name')} error={view.error}>
            {(aria) => (
              <Input
                {...aria}
                maxLength={200}
                value={form.name}
                onChange={(event) => view.onCompetencyChange({ name: event.target.value })}
              />
            )}
          </Field>
          {(['meaning', 'evidence'] as const).map((field) => (
            <Field key={field} field={field} label={t(`fields.${field}`)} error={view.error}>
              {(aria) => (
                <Textarea
                  {...aria}
                  rows={2}
                  maxLength={1000}
                  value={form[field]}
                  onChange={(event) => view.onCompetencyChange({ [field]: event.target.value })}
                />
              )}
            </Field>
          ))}
          {LEVELS.map((level) => (
            <div key={level} className="flex flex-col gap-1">
              <Label htmlFor={`catalogue-level-${level}`}>{t('fields.level', { level })}</Label>
              <Textarea
                id={`catalogue-level-${level}`}
                rows={2}
                maxLength={500}
                aria-invalid={view.error?.field === 'levels' || undefined}
                aria-describedby={view.error?.field === 'levels' ? errorId('levels') : undefined}
                value={form.levels[level]}
                onChange={(event) =>
                  view.onCompetencyChange({ levels: { ...form.levels, [level]: event.target.value } })
                }
              />
            </div>
          ))}
          {view.error?.field === 'levels' && (
            <p id={errorId('levels')} role="alert" className="text-meta font-semibold text-err-text">
              <RefusalText error={view.error} />
            </p>
          )}
          {jobTypeGroup('appliesTo', t('fields.appliesTo'))}
          {!isHint && jobTypeGroup('core', t('fields.core'), t('fields.coreHint'))}
          <RadioGroup
            legend={t('fields.levelNeeded')}
            options={[2, 3].map((level) => ({ value: String(level), label: t('fields.level', { level }) }))}
            value={String(form.levelNeeded)}
            onValueChange={(value) => view.onCompetencyChange({ levelNeeded: value === '2' ? 2 : 3 })}
          />
          <dl className="flex flex-col gap-1">
            <dt className="text-body font-semibold text-text">{t('fields.type')}</dt>
            <dd className="text-body text-text">{t('fields.desirable')}</dd>
            <dd className="text-meta text-text-2">{t(isHint ? 'fields.hintTypeHint' : 'fields.typeHint')}</dd>
          </dl>
          <FormRefusal view={view} shown={COMPETENCY_FIELDS} />
          <Actions view={view} />
        </form>
      )}
    </Dialog>
  );
}
