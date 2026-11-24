/** The artboards' upload arrow (FilePicker, "Import candidates", the "Upload CVs" card). `className` sets its size. */
export function UploadIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 20h14" />
    </svg>
  );
}
