FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
COPY . .
ENV DATABASE_URL=file:/tmp/ytarr-build.db
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates \
  && pip3 install --break-system-packages --no-cache-dir yt-dlp \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 ytarr \
  && useradd --system --uid 1001 --gid ytarr ytarr \
  && mkdir -p /config/thumbnails /media \
  && chown -R ytarr:ytarr /config /media
COPY --from=builder --chown=ytarr:ytarr /app/.next/standalone ./
COPY --from=builder --chown=ytarr:ytarr /app/.next/static ./.next/static
COPY --from=builder --chown=ytarr:ytarr /app/prisma ./prisma
COPY --from=builder --chown=ytarr:ytarr /app/node_modules ./node_modules
USER ytarr
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
