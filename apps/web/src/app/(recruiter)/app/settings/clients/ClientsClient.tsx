'use client';

import { ClientsList } from '@/features/clients/components/ClientsList.tsx';
import type { ClientRow } from '@/features/clients/domain/clients.ts';
import { useClientsController } from '@/features/clients/hooks/useClientsController.ts';

export function ClientsClient({ rows }: { rows: ClientRow[] }) {
  return <ClientsList view={useClientsController(rows)} />;
}
