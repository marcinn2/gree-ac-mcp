# =============================================================================
# Multi-arch build (linux/amd64 + linux/arm64)
# -----------------------------------------------------------------------------
# The base image (node:20-alpine) is a multi-arch manifest and this project has
# no native dependencies, so a single buildx invocation produces both arches.
#
# One-time setup:
#   docker buildx create --name multiarch --use
#   # only needed for emulated cross-builds (e.g. building arm64 on an amd64 host):
#   docker run --privileged --rm tonistiigi/binfmt --install all
#
# Build BOTH arches and push to a registry (a multi-arch manifest cannot be
# loaded into the local image store — it must be pushed):
#   docker buildx build \
#     --platform linux/amd64,linux/arm64 \
#     -t registry.example.com/gree-ac-mcp-server:1.0.0 \
#     -t registry.example.com/gree-ac-mcp-server:latest \
#     --push .
#
# Build a SINGLE arch locally for testing (can use --load):
#   docker buildx build --platform linux/arm64 -t gree-ac-mcp-server:test --load .
#
# Verify the published manifest covers both platforms:
#   docker buildx imagetools inspect registry.example.com/gree-ac-mcp-server:1.0.0
# =============================================================================

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies (including dev deps) against the lockfile when present.
COPY package.json package-lock.json* ./
RUN npm install

# Compile TypeScript to dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Strip dev dependencies for the runtime image.
RUN npm prune --omit=dev

# ---- runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Run as the unprivileged "node" user that ships with the official image.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node

EXPOSE 8080

# Default to HTTP mode reading a mounted config at /config/config.json.
ENTRYPOINT ["node", "dist/index.js", "--transport", "http", "--config", "/config/config.json"]
