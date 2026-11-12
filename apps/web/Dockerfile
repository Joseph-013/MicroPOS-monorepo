# Build from repo root: docker build -f apps/web/Dockerfile .
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @micropos/web...
RUN pnpm --filter @micropos/core build && pnpm --filter @micropos/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/web
USER node
EXPOSE 3000
CMD ["pnpm", "start"]
