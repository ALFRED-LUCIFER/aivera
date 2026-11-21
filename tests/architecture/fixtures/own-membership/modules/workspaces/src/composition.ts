export const active = (db: any, resolveActiveWorkspace: any) => db.transaction((tx: unknown) => resolveActiveWorkspace(tx, 'u'));
