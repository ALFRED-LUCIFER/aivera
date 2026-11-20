'use client';

import { useTranslations } from '@credalent/i18n/react';
import { FilePicker } from '@credalent/ui';
import { sample } from '../domain/sample.ts';
import { Section, State } from './Section.tsx';

const ignore = () => undefined;

/** The file picker (AIV-P0-016) at rest, uploading and refused, with its product copy from packages/i18n. */
export function UploadSection() {
  const t = useTranslations('files');
  return (
    <Section id="upload" title={sample.sections.upload}>
      <State title={sample.uploadStates.resting}>
        <FilePicker label={t('upload')} hint={t('limits.evidence')} accept=".pdf,.png" onSelect={ignore} />
      </State>
      <State title={sample.uploadStates.uploading}>
        <FilePicker
          label={t('uploadCv')}
          hint={t('limits.cv')}
          accept=".pdf,.docx"
          onSelect={ignore}
          disabled
          progress={40}
          status={t('uploading', { percent: 40 })}
        />
      </State>
      <State title={sample.uploadStates.refused}>
        <FilePicker
          label={t('upload')}
          hint={t('limits.evidence')}
          accept=".pdf,.png"
          onSelect={ignore}
          error={t('notAccepted')}
        />
      </State>
    </Section>
  );
}
