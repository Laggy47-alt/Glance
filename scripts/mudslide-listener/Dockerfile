FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY listener.mjs ./listener.mjs

ENV NODE_ENV=production \
    LISTEN_HOST=0.0.0.0 \
    LISTEN_PORT=3000 \
    MUDSLIDE_AUTH_DIR=/data/.mudslide

EXPOSE 3000

CMD ["node", "listener.mjs"]