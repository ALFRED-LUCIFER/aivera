'use client';

import { useConsoleOpened } from '@/features/ops/hooks/useConsoleOpened.ts';

/** Renders nothing: records "ops.console_opened" once per session (ADR-012). */
export function ConsoleOpened() {
  useConsoleOpened();
  return null;
}
