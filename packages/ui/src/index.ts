export { Button, buttonClassName } from './Button.tsx';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button.tsx';
export { Card, Skeleton } from './Card.tsx';
export type { CardProps, SkeletonProps } from './Card.tsx';
export { Checkbox } from './Checkbox.tsx';
export type { CheckboxProps } from './Checkbox.tsx';
export { Dialog, DialogClose } from './Dialog.tsx';
export type { DialogProps } from './Dialog.tsx';
export { Input, Label, Select, Textarea } from './Field.tsx';
export type { InputProps, LabelProps, SelectProps, TextareaProps } from './Field.tsx';
export { RadioGroup, SegmentedControl } from './RadioGroup.tsx';
export type { ChoiceOption, RadioGroupProps } from './RadioGroup.tsx';
export { Toast, ToastProvider } from './Toast.tsx';
export type { ToastProps, ToastProviderProps } from './Toast.tsx';
export { Tooltip } from './Tooltip.tsx';
export type { TooltipProps } from './Tooltip.tsx';

export { EvidenceHighlight } from './EvidenceHighlight.tsx';
export type { Citation, EvidenceHighlightProps } from './EvidenceHighlight.tsx';
export { ProvenanceTag } from './ProvenanceTag.tsx';
export type { Provenance, ProvenanceTagProps } from './ProvenanceTag.tsx';
export { StrengthMeter } from './StrengthMeter.tsx';
export type { Strength, StrengthMeterProps } from './StrengthMeter.tsx';
export { StatTile } from './StatTile.tsx';
export type { StatTileProps } from './StatTile.tsx';
export { ValueBasis } from './ValueBasis.tsx';
export type { ValueBasisKind, ValueBasisProps } from './ValueBasis.tsx';

// AIV-P0-024: preview-confirm card and assistant drawer frame
export { AssistantDrawer } from './AssistantDrawer.tsx';
export type { AssistantDrawerProps } from './AssistantDrawer.tsx';
export { PreviewBanner, PreviewConfirmCard, SuccessBanner } from './PreviewConfirm.tsx';
export type { PreviewConfirmCardProps, PreviewConfirmProps, SuccessBannerProps } from './PreviewConfirm.tsx';

// AIV-P0-021: data table, filter tabs, status badges and bulk-action bar
export { BulkActionBar } from './BulkActionBar.tsx';
export type { BulkAction, BulkActionBarProps, BulkPreviewHandler } from './BulkActionBar.tsx';
export { Chip, StatusBadge } from './Chip.tsx';
export type { ChipProps, ChipTone, StatusBadgeProps, StatusBadgeStatus } from './Chip.tsx';
export { DataTable } from './DataTable.tsx';
export type {
  DataTableColumn,
  DataTableProps,
  DataTableSelection,
  DataTableSort,
  SortDirection,
} from './DataTable.tsx';
export { FilterTabs } from './FilterTabs.tsx';
export type { FilterTab, FilterTabsProps } from './FilterTabs.tsx';

// AIV-P0-023: score with uncertainty, competency row and need-versus-proven
export { CompetencyRow } from './CompetencyRow.tsx';
export type { CompetencyRowProps } from './CompetencyRow.tsx';
export { NeedVsProvenBar, ScoreWithUncertainty } from './ScoreBar.tsx';
export type { NeedVsProvenBarProps, ScoreWithUncertaintyProps } from './ScoreBar.tsx';

// AIV-P3-003: the level a job needs, on the candidate site; AIV-P1-034: how many competencies meet the need ("4 of 6")
export { LevelMeter } from './LevelMeter.tsx';
export type { LevelMeterProps } from './LevelMeter.tsx';

// AIV-P0-016: the upload control of the Portal and CApply artboards
export { FilePicker } from './FilePicker.tsx';
export type { FilePickerProps } from './FilePicker.tsx';
// AIV-P1-101: its upload arrow, for "Import candidates" and the "Upload CVs" card too
export { UploadIcon } from './UploadIcon.tsx';
