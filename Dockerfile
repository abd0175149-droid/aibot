FROM node:22-alpine
WORKDIR /app

ARG GIT_REV=unknown
ENV GIT_REV=${GIT_REV}

RUN corepack enable && apk add --no-cache curl tini

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker

RUN pnpm install --frozen-lockfile --prod=false

RUN mkdir -p /app/media

# ملاحظة تنتقل من المشروع القائم: الصورة تشغّل **مصادر TypeScript** عبر tsx
# ولا يوجد /app/dist. تذكّرها عند التحقّق من أنّ الحاوية تحمل الكود الجديد:
#   docker compose exec api head -1 apps/api/src/main.ts
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--import", "tsx", "apps/api/src/main.ts"]
