# سند — production image. Node 22 (built-in SQLite for dev/staging; Postgres via DATABASE_URL in prod).
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

# non-root
RUN useradd -m -u 10001 sanad && mkdir -p /app/data && chown -R sanad:sanad /app
USER sanad

EXPOSE 4000
# entrypoint runs migrations then starts the server; --experimental-sqlite needed only for the SQLite driver.
CMD ["sh", "-c", "node --experimental-sqlite scripts/migrate.js && node --experimental-sqlite scripts/seed-rbac.js && node --experimental-sqlite src/server.js"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
