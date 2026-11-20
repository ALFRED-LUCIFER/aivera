// An inline server action as an object method: refused.
const actions = {
  async archive(form: FormData) {
    'use server';
    await getJobs().archive(form);
  },
};

export default function Page() {
  return <form action={actions.archive} />;
}
