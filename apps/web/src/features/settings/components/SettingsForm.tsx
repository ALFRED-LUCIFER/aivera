'use client';

import { useTranslations } from '@aivera/i18n/react';
import { Button, Checkbox, Input, Label, Skeleton, SuccessBanner } from '@aivera/ui';
import {
  changedFromDefault,
  DEFAULT_SETTINGS,
  isNumberSetting,
  SETTING_BOUNDS,
  SETTING_GROUPS,
  SETTING_UNITS,
  type SettingKey,
  type SettingsView,
} from '../domain/settings.ts';

const fieldId = (key: SettingKey) => `setting-${key}`;
const note = 'text-meta text-text-2';

/**
 * The workspace settings (AIV-P1-052): grouped fields, each with its label, a plain explanation, the allowed range and
 * "Default: N" when it differs. Admins edit and save; everyone else reads. `loading` until the values arrive.
 */
export function SettingsForm({ view, canEdit }: { view: SettingsView | 'loading'; canEdit: boolean }) {
  const t = useTranslations('settings');
  const ready = view !== 'loading';
  const saving = ready && view.status === 'saving';

  const field = (key: SettingKey) => {
    const id = fieldId(key);
    const changed = ready && changedFromDefault(view.form, key);
    const label = t(`fields.${key}.label`);
    const extras = (
      <>
        {changed && (
          <span className={note}>
            {isNumberSetting(key) ? t('default', { value: DEFAULT_SETTINGS[key] }) : t('defaultOff')}
          </span>
        )}
        {changed && canEdit && (
          <Button
            type="button"
            variant="ghost"
            aria-label={t('useDefaultFor', { label })}
            onClick={() => view.onUseDefault(key)}
          >
            {t('useDefault')}
          </Button>
        )}
      </>
    );
    if (!isNumberSetting(key))
      return (
        <div key={key} className="flex flex-col gap-1">
          <Checkbox
            id={id}
            label={label}
            checked={ready && view.form[key]}
            disabled={!ready || !canEdit}
            aria-describedby={`${id}-help`}
            onChange={(event) => ready && view.onChange(key, event.target.checked)}
          />
          <p id={`${id}-help`} className={note}>
            {t(`fields.${key}.help`)}
          </p>
          <div className="flex flex-wrap items-center gap-3">{extras}</div>
        </div>
      );
    const bounds = SETTING_BOUNDS[key];
    const invalid = ready && view.invalid.includes(key);
    return (
      <div key={key} className="flex flex-col gap-1">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-help`} className={note}>
          {t(`fields.${key}.help`)}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {ready ? (
            <Input
              id={id}
              inputMode="numeric"
              autoComplete="off"
              className="w-24"
              value={view.form[key]}
              readOnly={!canEdit}
              aria-invalid={invalid || undefined}
              aria-describedby={[`${id}-help`, `${id}-hint`, invalid && `${id}-error`].filter(Boolean).join(' ')}
              onChange={(event) => view.onChange(key, event.target.value)}
            />
          ) : (
            <Skeleton className="h-10 w-24" />
          )}
          <span id={`${id}-hint`} className={note}>
            {t(`hint.${SETTING_UNITS[key]}`, bounds)}
          </span>
          {extras}
        </div>
        {invalid && (
          <p id={`${id}-error`} role="alert" className="text-meta font-semibold text-err-text">
            {t('range', bounds)}
          </p>
        )}
      </div>
    );
  };

  return (
    <form
      noValidate
      aria-busy={!ready || undefined}
      className="flex max-w-3xl flex-col gap-8"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && canEdit) void view.onSave();
      }}
    >
      {!ready && <output className="sr-only">{t('loading')}</output>}
      {!canEdit && <p className="rounded-card border border-border bg-surface-subtle p-4 text-body">{t('readOnly')}</p>}
      {SETTING_GROUPS.map((group) => (
        <fieldset key={group.id} className="flex flex-col gap-5">
          <legend className="mb-3 text-section text-text">{t(`groups.${group.id}`)}</legend>
          {group.keys.map(field)}
        </fieldset>
      ))}
      {canEdit && (
        <div className="flex flex-col gap-3">
          <SuccessBanner>{ready && view.status === 'saved' && t('saved')}</SuccessBanner>
          {ready && view.status === 'failed' && (
            <p role="alert" className="text-body font-semibold text-err-text">
              {t('failed')}
            </p>
          )}
          <div>
            <Button type="submit" variant="primary" disabled={!ready || saving}>
              {saving ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
