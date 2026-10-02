# Construction Central Services ERP — production image
# Build:  docker build -t ccs-erp .
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_DIR=/app/storage/uploads \
    NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates postgresql-client && rm -rf /var/lib/apt/lists/* \
  && useradd -r -u 1001 -g node app && mkdir -p /app/storage/uploads && chown -R app:node /app
COPY --from=build --chown=app:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=app:node /app/node_modules ./node_modules
COPY --from=build --chown=app:node /app/.next ./.next
COPY --from=build --chown=app:node /app/public ./public
COPY --from=build --chown=app:node /app/prisma ./prisma
COPY --from=build --chown=app:node /app/src ./src
COPY --from=build --chown=app:node /app/tsconfig.json /app/next.config.ts ./
COPY --from=build --chown=app:node /app/scripts ./scripts
USER app
EXPOSE 3000
VOLUME ["/app/storage"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["sh", "./scripts/docker-entrypoint.sh"]
CMD ["npx", "next", "start", "-p", "3000"]
