# Image GéoMaurice : application React construite + serveur Node (API, modération).
# Construction : docker compose build   (voir README, section Docker)

ARG NODE_IMAGE=node:22-alpine
ARG PMTILES_VERSION=1.28.0
ARG TARGETARCH

# --- Outil pmtiles (sert uniquement à télécharger le fond de carte) ----------
FROM ${NODE_IMAGE} AS pmtiles-amd64
ARG PMTILES_VERSION
ADD https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz /tmp/pmtiles.tgz
RUN tar -xzf /tmp/pmtiles.tgz -C /tmp pmtiles

FROM ${NODE_IMAGE} AS pmtiles-arm64
ARG PMTILES_VERSION
ADD https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_arm64.tar.gz /tmp/pmtiles.tgz
RUN tar -xzf /tmp/pmtiles.tgz -C /tmp pmtiles

FROM pmtiles-${TARGETARCH} AS pmtiles

# --- Construction de l'application React (Vite) -------------------------------
FROM ${NODE_IMAGE} AS app-build
WORKDIR /build
COPY geo-maurice-app/package.json geo-maurice-app/package-lock.json ./
RUN npm ci
COPY geo-maurice-app/ ./
RUN npm run build

# --- Image finale --------------------------------------------------------------
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    TILES_DIR=/app/tiles \
    STATIC_DIR=/app/geo-maurice-app/dist
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=pmtiles /tmp/pmtiles /usr/local/bin/pmtiles
COPY server/server.js ./
COPY server/admin ./admin
COPY server/scripts ./scripts
COPY --from=app-build /build/dist /app/geo-maurice-app/dist

# Dossiers persistants (volumes) appartenant à l'utilisateur non root « node »
RUN mkdir -p /app/data /app/tiles && chown -R node:node /app/data /app/tiles
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
