'use server';

export async function checked() {
  await platformOperator();
}

export async function unchecked() {
  return null;
}
