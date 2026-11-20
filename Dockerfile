# Images for Azure dev (AIV-P0-006), built by .github/workflows/deploy-dev.yml:
#   docker build --target web .       Next.js standalone server, non-root, port 3000
#   docker build --target migrate .   `pnpm db:migrate` (node packages/db/src/cli.ts migrate), non-root
#   docker build --target worker .    the worker host (node apps/worker/src/main.ts), non-root, probes on 8080
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS source
WORKDIR /repo
RUN corepack enable
COPY . .
# No Git in the image, so no lifecycle scripts (lefthook needs Git); esbuild and sharp ship prebuilt binaries.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM source AS build
RUN pnpm --filter web build

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
# Standalone output leaves out public/ (the logo, AIV-P0-933); the server serves it from next to server.js.
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# shortcut: the migrate and worker images are the whole install stage (about 1.3 GB with dev tooling) because cli.ts finds modules/*/migrations through the repo layout; slim it with `pnpm deploy --filter @credalent/db --prod` plus the migration folders when pull time or image scanning matters (AIV-P5-E03, #34)
FROM source AS migrate
USER node
CMD ["node", "packages/db/src/cli.ts", "migrate"]

FROM source AS worker
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "apps/worker/src/main.ts"]
