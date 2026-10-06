# WhatsApp PA bot — needs Chromium (whatsapp-web.js) and ffmpeg (voice notes)
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ffmpeg fonts-noto-color-emoji ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production
WORKDIR /app
COPY package*.json ./
COPY patches ./patches
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc && npm prune --omit=dev
# WhatsApp session lives here — mount a volume so restarts don't need a new QR scan.
RUN mkdir -p /app/.wwebjs_auth && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
