// A workspace's daily AI token budget in the operator console (AIV-P2-038, ADR-012). Pure: no React, no I/O (ADR-003).
import { AI_DAILY_TOKEN_BUDGET } from '@credalent/workspaces';
import { z } from 'zod';

/** The platform default and the bounds of an override, for the form's hint and messages. */
export { AI_DAILY_TOKEN_BUDGET } from '@credalent/workspaces';

/**
 * A budget change, checked in the form and again in the server action: a whole number of tokens within the bounds, or
 * null to go back to the platform default, with the operator's reason. The database's check constraint is the last
 * layer.
 */
export const aiBudgetChangeSchema = z.object({
  workspaceId: z.uuid(),
  dailyBudget: z.int().min(AI_DAILY_TOKEN_BUDGET.min).max(AI_DAILY_TOKEN_BUDGET.max).nullable(),
  reason: z.string().trim().min(1).max(500),
});
export type AiBudgetChange = z.infer<typeof aiBudgetChangeSchema>;

/** "500,000" or "500000" as a number; NaN for anything else, which the schema refuses like an out-of-range value. */
export const parseTokens = (text: string): number => {
  const trimmed = text.trim();
  return /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(trimmed) ? Number(trimmed.replaceAll(',', '')) : Number.NaN;
};

/** Which field the form flags: the budget's bounds or the missing reason. */
export type AiBudgetError = 'bounds' | 'reason';

/** The first problem with `change` (the budget before the reason), or null when it may be previewed. */
export function aiBudgetError(change: AiBudgetChange): AiBudgetError | null {
  const result = aiBudgetChangeSchema.safeParse(change);
  if (result.success) return null;
  return result.error.issues.some((issue) => issue.path[0] === 'dailyBudget') ? 'bounds' : 'reason';
}

/** The budget form's view model: the fields, the change waiting for Confirm, and the last confirmed change. */
export type AiBudgetView = {
  budget: string;
  reason: string;
  error: AiBudgetError | null;
  onBudgetChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onPreview: () => void;
  onPreviewReset: () => void;
  /** The change waiting for Confirm: the budget in force and the proposed one; `reset`: back to the default. */
  preview: { from: number; to: number; reset: boolean } | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  /** The confirmed budget for the success message; null: back to the default; undefined: nothing confirmed yet. */
  saved: number | null | undefined;
};
