export const widen = (tx: any) => tx.execute("select set_config('app.user_id', 'u', true)");
