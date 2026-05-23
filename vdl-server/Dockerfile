# Build from repository root so `file:../packages/shared` resolves.
# From vdl-server/: `docker compose build` (compose sets context: ..).

FROM node:20-slim AS build

WORKDIR /app/packages/shared
COPY packages/shared/package.json packages/shared/tsconfig.json ./
COPY packages/shared/src ./src/
RUN npm install && npm run build

WORKDIR /app/vdl-server
COPY vdl-server/package.json vdl-server/package-lock.json ./
RUN npm ci
COPY vdl-server/tsconfig.json ./
COPY vdl-server/src ./src/
RUN npm run build

# -----------------------------------------------------------
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      curl \
      python3 \
      python3-pip \
      ca-certificates \
      gnupg \
    && pip3 install --break-system-packages yt-dlp \
    && curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
       | gpg --dearmor -o /usr/share/keyrings/cloudflare-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/cloudflare-archive-keyring.gpg] https://pkg.cloudflare.com/cloudflared any main" \
       > /etc/apt/sources.list.d/cloudflared.list \
    && apt-get update && apt-get install -y --no-install-recommends cloudflared \
    && apt-get purge -y gnupg && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/vdl-server

COPY vdl-server/package.json vdl-server/package-lock.json ./
COPY --from=build /app/packages/shared /app/packages/shared
RUN npm ci --omit=dev

COPY --from=build /app/vdl-server/dist/ dist/
COPY vdl-server/scripts/ scripts/
COPY vdl-server/public/ public/

RUN mkdir -p data tmp/dl tmp/serve \
    && chmod +x scripts/start-with-tunnel.sh

EXPOSE 30010

CMD ["bash", "scripts/start-with-tunnel.sh"]
