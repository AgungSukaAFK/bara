# syntax=docker/dockerfile:1.7
# Image Smart BARA untuk Coolify (vanilla JS + server Node http, bukan Next.js).
# Standar: ~/project/lourdes-db/docs/standar-app.md §10.
# Env runtime saja (JANGAN centang "Available at Buildtime"):
#   SUPABASE_URL=https://db.lourdes.cloud, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY
#   BUDGET_UPSTREAM=<URL container Aplikasi Budget 2027>, mis. http://<nama-container>:3000 (proxy /budget/*)

# Node >= 23.6 diperlukan untuk menjalankan server/budget-ai.mts (type stripping).
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# Hanya file yang dipakai server; data/, docs/, backup, dll. tidak masuk image.
COPY server.mjs ./
COPY server ./server
COPY api/smart-asset.js ./api/
COPY smart-asset-project/index.html smart-asset-project/styles.css smart-asset-project/app.js ./smart-asset-project/
COPY js ./js
COPY css ./css
COPY assets ./assets
COPY *.html ./

USER node
EXPOSE 3000
# Healthcheck lewat 127.0.0.1 (bukan localhost: di Alpine localhost = ::1)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "--dns-result-order=ipv4first", "--no-network-family-autoselection", "server.mjs"]
