// An inline server action in a component: refused.
export default function Page() {
  async function save(form: FormData) {
    'use server';
    await getJobs().create(form);
  }
  return <form action={save} />;
}
