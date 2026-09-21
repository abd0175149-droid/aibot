FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
ARG GIT_REV=unknown
ENV GIT_REV=${GIT_REV} NEXT_TELEMETRY_DISABLED=1

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @aibot/web...
RUN pnpm --filter @aibot/web run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# standalone يحمل تبعيّاته معه — لا pnpm install في صورة التشغيل
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3070
CMD ["node", "apps/web/server.js"]
