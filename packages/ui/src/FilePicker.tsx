'use client';

import { useId, useRef } from 'react';
import { Button } from './Button.tsx';
import { UploadIcon } from './UploadIcon.tsx';

// AIV-P0-016: the upload control of the Portal ("Upload a file", "PDF, image or document, up to 20 MB.") and CApply
// ("Upload CV", "PDF or Word, up to 10 MB.") artboards: a secondary button with the upload icon and the limits beside it.
// Deviations from the artboards, which draw only the resting state:
// - the progress bar, the status line and the error line are not drawn there; they follow the Field error style
//   (err-text with an icon and words) and DESIGN.md's rule that status colour always travels with an icon and a word;
// - no drag and drop: the artboards show a button only.

export type FilePickerProps = {
  /** The button's words, e.g. "Upload a file". */
  label: string;
  /** The limits, e.g. "PDF, image or document, up to 20 MB."; the button is described by it. */
  hint: string;
  /** The input's `accept`, e.g. ".pdf,.docx". The server checks again: this only filters the browser's dialog. */
  accept: string;
  /** The chosen files: one, or with `multiple` every file of one pick, in the order the browser gives them. */
  onSelect: (files: File[]) => void;
  /** Several files in one pick (AIV-P1-165, Add CVs). */
  multiple?: boolean;
  disabled?: boolean;
  /** 0 to 100 while uploading, otherwise null. */
  progress?: number | null;
  /** Announced politely: "Uploading… 40%", "Checking the file…", "Uploaded." */
  status?: string | null;
  /** The size, type or scan refusal, e.g. "We cannot use this file." */
  error?: string | null;
};

/** A real button opening the browser's file dialog; a native file input keeps its accessibility and mobile pickers. */
export function FilePicker({
  label,
  hint,
  accept,
  onSelect,
  multiple,
  disabled,
  progress,
  status,
  error,
}: FilePickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={disabled}
          aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
          onClick={() => input.current?.click()}
        >
          <UploadIcon />
          {label}
        </Button>
        <span id={`${id}-hint`} className="text-meta text-text-2">
          {hint}
        </span>
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple={multiple}
          hidden
          tabIndex={-1}
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            // Cleared, so choosing the same file again after an error fires again.
            event.currentTarget.value = '';
            if (files.length > 0) onSelect(files);
          }}
        />
      </div>
      {typeof progress === 'number' && (
        <progress value={progress} max={100} aria-label={status ?? label} className="h-1 w-full max-w-80 accent-text" />
      )}
      {/* <output> carries the status role, so the line is announced politely. */}
      <output className="block text-meta text-text-2 empty:hidden">{status}</output>
      {error && (
        <p id={`${id}-error`} className="flex items-center gap-1.5 text-meta text-err-text">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 4.75v3.75M8 10.75v.5" strokeLinecap="round" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}
