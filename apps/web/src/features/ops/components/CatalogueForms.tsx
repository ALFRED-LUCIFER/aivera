'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Checkbox, Dialog, Input, Label, RadioGroup, Textarea } from '@credalent/ui';
import type { FormEvent, ReactNode } from 'react';
import type { EditorField, EditorViewModel, Refusal } from '../domain/catalogueEditor.ts';

/** A refusal in words: the rule it broke, never the refused text. */
export function RefusalText({ error }: { error: Refusal }) {
  const t = useTranslations('ops.catalogue.editor.errors');
  if (error.error === 'stale') return error.by ? t('stale', { name: error.by }) : t('staleUnknown');
  if (error.error === 'invalid') return error.field === 'key' ? t('invalid.key') : t('invalid.other');
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

const LEVELS = [1, 3, 5] as const;
const COMPETENCY_FIELDS: readonly (EditorField | undefined)[] = [...FORM_FIELDS, 'appliesTo', 'core'];

/** Add or edit a pack competency: always Desirable; the fairness check's message goes under the field it names. */
export function CompetencyFormDialog({ view }: { view: EditorViewModel }) {
  const t = useTranslations('ops.catalogue.editor');
  const form = view.competencyForm;
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
      title={form?.position === null ? t('addCompetency') : t('editCompetency')}
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
          {jobTypeGroup('core', t('fields.core'), t('fields.coreHint'))}
          <RadioGroup
            legend={t('fields.levelNeeded')}
            options={[2, 3].map((level) => ({ value: String(level), label: t('fields.level', { level }) }))}
            value={String(form.levelNeeded)}
            onValueChange={(value) => view.onCompetencyChange({ levelNeeded: value === '2' ? 2 : 3 })}
          />
          <dl className="flex flex-col gap-1">
            <dt className="text-body font-semibold text-text">{t('fields.type')}</dt>
            <dd className="text-body text-text">{t('fields.desirable')}</dd>
            <dd className="text-meta text-text-2">{t('fields.typeHint')}</dd>
          </dl>
          <FormRefusal view={view} shown={COMPETENCY_FIELDS} />
          <Actions view={view} />
        </form>
      )}
    </Dialog>
  );
}
