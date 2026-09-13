FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
# The runner stage installs Debian's own `chromium` package for Channels overlay rendering
# (lib/overlay/puppeteer.ts) instead of Puppeteer's bundled download -- apt resolves that
# package's ~20 runtime shared-library dependencies automatically, and it's the browser that
# actually ships in the final image. Skipping Puppeteer's own download here also sidesteps a
# real build-breaker: its postinstall fetches both "chrome" and "chrome-headless-shell" in
# parallel and calls process.exit(1) if either fails, which would fail this `npm ci`.
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci --no-audit --no-fund

FROM deps AS builder
COPY . .
ENV DATABASE_URL=file:/tmp/tunarrtube-build.db
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# YTARR_PUPPETEER_EXECUTABLE_PATH points the Channels overlay-render feature (lib/overlay/puppeteer.ts)
# at Debian's own chromium package -- see the deps-stage PUPPETEER_SKIP_DOWNLOAD comment above.
ENV YTARR_PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates chromium \
  && pip3 install --break-system-packages --no-cache-dir yt-dlp \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 tunarrtube \
  && useradd --system --uid 1001 --gid tunarrtube --create-home tunarrtube \
  && mkdir -p /config/thumbnails /media \
  && chown -R tunarrtube:tunarrtube /config /media /home/tunarrtube
COPY --from=builder --chown=tunarrtube:tunarrtube /app/.next/standalone ./
COPY --from=builder --chown=tunarrtube:tunarrtube /app/.next/static ./.next/static
COPY --from=builder --chown=tunarrtube:tunarrtube /app/prisma ./prisma
COPY --from=builder --chown=tunarrtube:tunarrtube /app/node_modules ./node_modules
USER tunarrtube
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
