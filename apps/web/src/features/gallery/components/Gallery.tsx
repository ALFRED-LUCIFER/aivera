'use client';

import tokens from '@credalent/tokens/tokens.json' with { type: 'json' };
import {
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  Input,
  Label,
  RadioGroup,
  SegmentedControl,
  Select,
  Skeleton,
  StatusBadge,
  Textarea,
  Toast,
  ToastProvider,
  Tooltip,
} from '@credalent/ui';
import { sample } from '../domain/sample.ts';
import { Section } from './Section.tsx';
import { EvidenceSections } from './EvidenceSections.tsx';
import { UploadSection } from './UploadSection.tsx';
import { WorkflowSections, type WorkflowProps } from './WorkflowSections.tsx';

type GalleryProps = WorkflowProps & {
  theme: 'light' | 'dark';
  onThemeChange: (theme: string) => void;
  toastOpen: boolean;
  onToastOpenChange: (open: boolean) => void;
};

const s = sample.sections;
const choices = (labels: readonly string[]) => labels.map((label) => ({ value: label, label }));

function ColourTable({ theme }: { theme: 'light' | 'dark' }) {
  const t = sample.colourTable;
  return (
    <table className="text-body text-text">
      <caption className="mb-2 text-start text-card">{t[theme]}</caption>
      <thead className="text-meta text-text-2">
        <tr>
          <th scope="col" className="pe-4 text-start">
            {t.token}
          </th>
          <th scope="col" className="pe-4 text-start">
            {t.value}
          </th>
          <th scope="col" className="text-start">
            {t.swatch}
          </th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(tokens.color[theme]).map(([name, hex]) => (
          <tr key={name} data-token={name}>
            <th scope="row" className="pe-4 text-start font-mono font-normal">
              {name}
            </th>
            <td className="pe-4 font-mono">{hex}</td>
            <td>
              {/* The value comes from packages/tokens, so the gallery can never drift from it. */}
              <span className="block h-4 w-10 rounded-tag border border-border" style={{ background: hex }} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Gallery({ theme, onThemeChange, toastOpen, onToastOpenChange, ...workflow }: GalleryProps) {
  return (
    <ToastProvider toastLabel={sample.overlays.toastLabel} regionLabel={sample.overlays.toastRegion}>
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-title text-text">{sample.title}</h1>
            <p className="text-body text-text-2">{sample.intro}</p>
          </div>
          <SegmentedControl
            legend={sample.theme}
            value={theme}
            onValueChange={onThemeChange}
            options={[
              { value: 'light', label: sample.light },
              { value: 'dark', label: sample.dark },
            ]}
          />
        </header>

        <Section id="colours" title={s.colours}>
          <div className="flex flex-wrap gap-8">
            <ColourTable theme="light" />
            <ColourTable theme="dark" />
          </div>
        </Section>

        <Section id="typography" title={s.typography}>
          <p className="font-display text-title">{sample.type.title}</p>
          <p className="font-display text-section">{sample.type.section}</p>
          <p className="text-card">{sample.type.card}</p>
          <p className="text-body">{sample.type.body}</p>
          <p className="text-meta text-text-2">{sample.type.meta}</p>
          <p className="font-mono text-meta">{sample.type.mono}</p>
        </Section>

        <Section id="buttons" title={s.buttons}>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">{sample.buttons.primary}</Button>
            <Button>{sample.buttons.secondary}</Button>
            <Button variant="ghost">{sample.buttons.ghost}</Button>
            <Button disabled>{sample.buttons.unavailable}</Button>
            <Button size="compact">{sample.buttons.compact}</Button>
            <Button size="touch">{sample.buttons.touch}</Button>
            <Button size="large">{sample.buttons.large}</Button>
          </div>
        </Section>

        <Section id="controls" title={s.controls}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="g-name">{sample.controls.name}</Label>
              <Input id="g-name" defaultValue={sample.controls.nameValue} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="g-owner">{sample.controls.invalid}</Label>
              <Input id="g-owner" aria-invalid aria-describedby="g-owner-hint" />
              <p id="g-owner-hint" className="text-meta text-err-text">
                {sample.controls.invalidHint}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="g-ws">{sample.controls.disabled}</Label>
              <Input id="g-ws" disabled defaultValue={sample.controls.disabledValue} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="g-loc">{sample.controls.location}</Label>
              <Select id="g-loc">
                {sample.controls.locations.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="g-notes">{sample.controls.notes}</Label>
              <Textarea id="g-notes" rows={2} />
            </div>
            <div className="flex flex-col">
              <Checkbox label={sample.controls.remind} defaultChecked />
              <Checkbox label={sample.controls.locked} disabled />
            </div>
            <RadioGroup
              legend={sample.controls.round}
              options={choices(sample.controls.rounds)}
              defaultValue={sample.controls.rounds[0]}
            />
            <SegmentedControl
              legend={sample.controls.shown}
              options={choices(sample.controls.levels)}
              defaultValue={sample.controls.levels[2]}
            />
            <Card title={sample.controls.card}>{sample.controls.cardBody}</Card>
            <Card title={sample.controls.loadingCard} loading loadingLabel={sample.controls.loading} />
            <Skeleton className="h-6 w-48" />
          </div>
        </Section>

        <Section id="overlays" title={s.overlays}>
          <div className="flex flex-wrap gap-3">
            <Dialog
              title={sample.overlays.dialogTitle}
              description={sample.overlays.dialogBody}
              closeLabel={sample.overlays.close}
              trigger={<Button>{sample.overlays.openDialog}</Button>}
            />
            <Tooltip content={sample.overlays.tooltipText}>
              <Button>{sample.overlays.tooltip}</Button>
            </Tooltip>
            <Button onClick={() => onToastOpenChange(true)}>{sample.overlays.showToast}</Button>
          </div>
          <Toast
            title={sample.overlays.toastTitle}
            description={sample.overlays.toastBody}
            closeLabel={sample.overlays.close}
            open={toastOpen}
            onOpenChange={onToastOpenChange}
            duration={Infinity}
          />
        </Section>

        <Section id="status" title={s.status}>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status="supported" label={sample.status.supported} />
            <StatusBadge status="needsValidation" label={sample.status.needsValidation} />
            <StatusBadge status="contradiction" label={sample.status.contradiction} />
            <StatusBadge status="informational" label={sample.status.informational} />
          </div>
          <div className="flex flex-wrap gap-2">
            {(['neutral', 'ok', 'warn', 'err', 'info'] as const).map((tone) => (
              <Chip key={tone} tone={tone}>
                {sample.status.chips[tone]}
              </Chip>
            ))}
          </div>
        </Section>

        <EvidenceSections />
        <WorkflowSections {...workflow} />
        <UploadSection />
      </main>
    </ToastProvider>
  );
}
