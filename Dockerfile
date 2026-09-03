# =============================================================================
# Multi-arch build (linux/amd64 + linux/arm64) for GitHub Container Registry
# -----------------------------------------------------------------------------
# The base image (node:24-alpine) is a multi-arch manifest and this project has
# no native dependencies, so a single buildx invocation produces both arches.
#
# One-time setup:
#   echo "$GHCR_PAT" | docker login ghcr.io -u marcinn2 --password-stdin
#   docker buildx create --name multiarch --driver docker-container --use
#   docker buildx inspect --bootstrap
#
# Build BOTH arches and push (a multi-arch manifest cannot be loaded into the
# local image store — it must be pushed):
#   docker buildx build \
#     --platform linux/amd64,linux/arm64 \
#     --build-arg VERSION=1.0.0 \
#     -t ghcr.io/marcinn2/gree-ac-mcp:1.0.0 \
#     -t ghcr.io/marcinn2/gree-ac-mcp:latest \
#     --push .
#
# Build a SINGLE arch locally for testing (can use --load):
#   docker buildx build --platform linux/arm64 -t gree-ac-mcp:test --load .
#
# Verify the published manifest covers both platforms:
#   docker buildx imagetools inspect ghcr.io/marcinn2/gree-ac-mcp:1.0.0
# =============================================================================

# ---- build stage ----
FROM node:24-alpine AS build
WORKDIR /app

# Install dependencies (including dev deps) against the lockfile when present.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Compile TypeScript to dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Strip dev dependencies for the runtime image.
RUN npm prune --omit=dev

# ---- runtime stage ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Version stamped into the OCI labels; override with --build-arg VERSION=x.y.z.
ARG VERSION=0.1.0

# OCI labels. "image.source" is the one GHCR uses to link this package to the
# repository, which is what makes the package inherit the repo README and lets
# it be made public from the repo's package settings.
LABEL org.opencontainers.image.source="https://github.com/marcinn2/gree-ac-mcp" \
      org.opencontainers.image.url="https://github.com/marcinn2/gree-ac-mcp" \
      org.opencontainers.image.documentation="https://github.com/marcinn2/gree-ac-mcp#readme" \
      org.opencontainers.image.title="gree-ac-mcp-server" \
      org.opencontainers.image.description="Model Context Protocol server for controlling GREE/EWPE-compatible WiFi air conditioners over their native UDP protocol" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"

# Run as the unprivileged "node" user that ships with the official image.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node

EXPOSE 8080

# Default to HTTP mode reading a mounted config at /config/config.json.
ENTRYPOINT ["node", "dist/index.js", "--transport", "http", "--config", "/config/config.json"]
