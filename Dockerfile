# syntax=docker/dockerfile:1

# One Dockerfile, parameterised by SERVICE, rather than five near-identical
# copies. The services differ only in their name: same layout, same scripts,
# same two shared packages. Five files would drift.
#
# The build context is the REPO ROOT, not the service directory, because each
# service depends on packages/shared-events and packages/shared-observability
# through `file:../packages/...`. npm cannot resolve those from inside a
# service-scoped context.

ARG NODE_VERSION=22-alpine

# ---------------------------------------------------------------- dependencies
FROM node:${NODE_VERSION} AS deps
ARG SERVICE
WORKDIR /repo

# Manifests first, so a source-only change does not invalidate the install
# layer. The shared packages need their own sources present because `npm
# install` runs their prepare/build.
COPY packages/shared-events/package*.json      ./packages/shared-events/
COPY packages/shared-observability/package*.json ./packages/shared-observability/
COPY ${SERVICE}/package*.json                  ./${SERVICE}/

COPY packages ./packages

RUN npm --prefix packages/shared-events install --no-audit --no-fund \
 && npm --prefix packages/shared-observability install --no-audit --no-fund \
 && npm --prefix packages/shared-events run build \
 && npm --prefix packages/shared-observability run build

RUN npm --prefix ${SERVICE} install --no-audit --no-fund

# ---------------------------------------------------------------------- build
FROM deps AS build
ARG SERVICE
WORKDIR /repo
COPY ${SERVICE} ./${SERVICE}
# The install above created the symlinks; re-linking after COPY keeps them.
RUN npm --prefix ${SERVICE} install --no-audit --no-fund \
 && npm --prefix ${SERVICE} run build

# -------------------------------------------------------------------- runtime
FROM node:${NODE_VERSION} AS runtime
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app

# node:alpine ships a `node` user. Running as root inside a container is one
# fewer barrier between a code-execution bug and the host.
RUN mkdir -p /app/logs && chown -R node:node /app

COPY --from=build --chown=node:node /repo/${SERVICE}/dist          ./dist
COPY --from=build --chown=node:node /repo/${SERVICE}/node_modules  ./node_modules
COPY --from=build --chown=node:node /repo/${SERVICE}/package.json  ./package.json
# The shared packages are symlinked into node_modules, so their built output
# has to come along too.
COPY --from=build --chown=node:node /repo/packages ../packages

USER node

# Compose overrides this per service; the default keeps `docker run` usable.
EXPOSE 5000

# No health check here: every service serves /health, and compose declares it
# with the right port. Duplicating it would mean two places to keep correct.

CMD ["node", "dist/index.js"]
