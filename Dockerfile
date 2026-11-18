# Images for Azure dev (AIV-P0-006), built by .github/workflows/deploy-dev.yml:
#   docker build --target web .       Next.js standalone server, non-root, port 3000
#   docker build --target migrate .   `pnpm db:migrate` (node packages/db/src/cli.ts migrate), non-root
FROM node:24-alpine AS source
WORKDIR /repo
RUN corepack enable
COPY . .
# No Git in the image, so no lifecycle scripts (lefthook needs Git); esbuild and sharp ship prebuilt binaries.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM source AS build
RUN pnpm --filter web build

FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM source AS migrate
USER node
CMD ["node", "packages/db/src/cli.ts", "migrate"]
