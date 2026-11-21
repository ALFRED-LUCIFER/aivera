export const resolveActiveWorkspace = (tx: any, userId: string) => tx.execute(`select set_config('app.user_id', ${userId}, true)`);
