FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
ARG GIT_REV=unknown
# ★ `PUBLIC_URL` وسيطُ **بناء** لا وسيطُ تشغيل: متغيّرات `NEXT_PUBLIC_*` تُحقن
#   في الحزمة وقت البناء، ورؤوسُ `headers()` تُخبز في `routes-manifest.json`
#   وقتَه أيضاً. فضبطُها في `environment` وحدَه يصل الخادمَ ولا يصل أيّاً منهما
#   — ولذلك كان `connect-src` يُشتقّ من قيمةٍ فارغة.
ARG PUBLIC_URL=https://aibot.masaros.net
ENV GIT_REV=${GIT_REV} NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=${PUBLIC_URL}/api

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @aibot/web...
RUN pnpm --filter @aibot/web run build

FROM node:22-alpine
WORKDIR /app
# ★ `GIT_REV` يُعاد إعلانُه في طبقة التشغيل — و`ARG` في طبقة البناء لا يعبر.
#   ومسارُ `/rev` يقرؤه **وقت التشغيل** (‏`force-dynamic`)، فبلا هذا يقول
#   «unknown» فتُفشل بوّابةُ النشر نشراً سليماً — إنذارٌ كاذبٌ أسوأ من غيابها.
ARG GIT_REV=unknown
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 GIT_REV=${GIT_REV}
# standalone يحمل تبعيّاته معه — لا pnpm install في صورة التشغيل
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3070
CMD ["node", "apps/web/server.js"]
