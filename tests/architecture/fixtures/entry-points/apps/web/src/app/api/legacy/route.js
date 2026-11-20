// A JavaScript route is a route too.
export async function GET() {
  return Response.json(await getJobs().list());
}
