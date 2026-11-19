// The page awaits the policy, but its metadata, which names the console, does not.
export async function generateMetadata() {
  return { title: 'Aivera operations' };
}

export default async function Page() {
  await platformOperator();
  return null;
}
