# syntax=docker/dockerfile:1
# One image, two roles: `node apps/api/dist/main.js` (API, default) or
# `node apps/api/dist/workers/workers.main.js` (queue workers) — same
# codebase, separate process, per docs/02 §2.3.
#
# Node 24 is required: @opspilot/types ships raw TypeScript (no build step)
# and relies on Node's native type stripping; the npm workspace symlink keeps
# the package outside node_modules, where stripping is allowed.
# Debian-slim (not alpine): bcrypt ships glibc prebuilds — musl would compile
# from source and needs a toolchain the image doesn't carry.

FROM node:24-slim AS build
# openssl present at generate-time so Prisma detects the right engine variant
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
RUN npm ci -w apps/api -w packages/types --include-workspace-root
COPY packages/types packages/types
COPY apps/api apps/api
RUN npm run prisma:generate -w apps/api && npm run build -w apps/api

FROM node:24-slim AS runtime
ENV NODE_ENV=production
# Prisma query engine links against OpenSSL
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates wget \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
# prisma CLI is added back on purpose: the deploy step runs
# `prisma migrate deploy` inside this same image (single-artifact deploys).
RUN npm ci --omit=dev -w apps/api -w packages/types --include-workspace-root \
  && npm install --no-save prisma@^6.2.0 \
  && npm cache clean --force
COPY packages/types packages/types
COPY apps/api/prisma apps/api/prisma
# Generated Prisma client (engines included) comes from the build stage
COPY --from=build /repo/node_modules/.prisma /repo/node_modules/.prisma
COPY --from=build /repo/apps/api/dist apps/api/dist
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
