# Brinkgame-Server. Bauen aus dem Projektordner:  docker build -f deploy/Dockerfile -t brinkgame .
# Stufe 1 baut die Web-Oberfläche, damit man auch im Browser mitspielen kann.
FROM node:22-alpine AS web
WORKDIR /src/client
COPY client/package.json client/package-lock.json ./
# --ignore-scripts: der Electron-Download wird für die Web-Oberfläche nicht gebraucht
RUN npm ci --ignore-scripts
COPY client/ ./
RUN node scripts/build-packs.mjs && node scripts/build.mjs

FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 WEB_DIR=/app/web
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=web /src/client/dist /app/web
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "src/index.js"]
