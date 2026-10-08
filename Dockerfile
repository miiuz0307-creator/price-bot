# Price Bot — one container: API + WhatsApp bot + web app.
# Works on Railway, Render, Fly.io or any VPS with Docker.

FROM node:24-bookworm-slim AS build
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

COPY . .
# Only the server, the web app and their workspace libraries (skips the Expo app).
RUN pnpm install --frozen-lockfile \
      --filter "@workspace/api-server..." \
      --filter "@workspace/price-bot..."
RUN pnpm --filter @workspace/api-server run build \
 && NODE_ENV=production BASE_PATH=/ pnpm --filter @workspace/price-bot run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8080 WHATSAPP_AUTH_DIR=/data/whatsapp
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data/whatsapp && chown -R node:node /data /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
