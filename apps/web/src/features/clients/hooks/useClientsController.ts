import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ClientResult, ClientRow, ClientsView } from '../domain/clients.ts';
import * as actions from '../services/clients.ts';

/**
 * Settings > Clients (AIV-P1-056): add, rename and archive (after confirming). After each change the page reloads the
 * list from the server.
 */
export function useClientsController(rows: ClientRow[], services = actions): ClientsView {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<ClientsView['error']>(null);
  const [pending, setPending] = useState(false);
  const [renaming, setRenaming] = useState<ClientsView['renaming']>(null);
  const [archiving, setArchiving] = useState<ClientRow | null>(null);
  const [done, setDone] = useState<ClientsView['done']>(null);

  const run = async (work: () => Promise<ClientResult>): Promise<ClientResult> => {
    setPending(true);
    setDone(null);
    try {
      return await work();
    } catch {
      return { ok: false, error: 'failed' };
    } finally {
      setPending(false);
    }
  };

  return {
    rows,
    name,
    onNameChange: setName,
    error,
    pending,
    async onAdd() {
      const result = await run(() => services.addClient(name));
      setError(result.ok ? null : result.error);
      if (!result.ok) return;
      setName('');
      setDone('added');
      router.refresh();
    },
    renaming,
    onRenameOpen: (row) => setRenaming({ id: row.id, name: row.name, error: null }),
    onRenameChange: (next) => setRenaming((r) => r && { ...r, name: next }),
    async onRename() {
      if (!renaming) return;
      const result = await run(() => services.renameClient(renaming.id, renaming.name));
      if (!result.ok) return setRenaming({ ...renaming, error: result.error });
      setRenaming(null);
      setDone('renamed');
      router.refresh();
    },
    archiving,
    onArchiveOpen: setArchiving,
    async onArchive() {
      if (!archiving) return;
      const result = await run(() => services.archiveClient(archiving.id));
      setArchiving(null);
      setDone(result.ok ? 'archived' : null);
      if (!result.ok) setError(result.error);
      router.refresh();
    },
    onClose: () => {
      setRenaming(null);
      setArchiving(null);
    },
    done,
  };
}
