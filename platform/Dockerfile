# سند — production image. Node 22 (built-in SQLite for dev/staging; Postgres via DATABASE_URL in prod).
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
# No `|| npm install` fallback: on lockfile drift `npm install` silently resolves DIFFERENT versions
# and rewrites the lock — defeating the reproducible-build guarantee exactly in the production image.
# A failing `npm ci` must fail the build so the lockfile gets fixed, not bypassed.
RUN npm ci --omit=dev

COPY . .

# non-root
RUN useradd -m -u 10001 sanad && mkdir -p /app/data && chown -R sanad:sanad /app
USER sanad

EXPOSE 8080
# entrypoint: single boot path (scripts/boot.sh) — schema → RBAC → (demo seed for staging OR
# bootstrap admin for production, switched by SANAD_SEED_DEMO) → server. Railway overrides this
# with the same startCommand; keeping them identical avoids drift.
CMD ["sh", "scripts/boot.sh"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
