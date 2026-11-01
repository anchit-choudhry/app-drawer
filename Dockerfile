# syntax=docker/dockerfile:1

# Runs express-static-serve as one plain node process, as a non-root user. dist/ is built outside
# this repo by design, so it is mounted at runtime and never copied into the image:
#
#   docker build -t app-drawer .
#   docker run --init -p 3000:3000 \
#     -v "$PWD/packages/express-static-serve/dist:/app/packages/express-static-serve/dist:ro" \
#     app-drawer
#
# Replicas and restarts are left to the container platform, so PM2 is not used here. The Node
# major matches .nvmrc and the `engines` field.

FROM node:26-slim AS deps
WORKDIR /app
# .npmrc carries ignore-scripts, engine-strict and min-release-age, so it must be copied.
COPY .npmrc package.json package-lock.json ./
COPY packages/express-static-serve/package.json packages/express-static-serve/
RUN npm ci --omit=dev --workspace=express-static-serve

FROM node:26-slim
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node packages/express-static-serve/package.json \
     packages/express-static-serve/server.js \
     packages/express-static-serve/trust-proxy.js \
     packages/express-static-serve/
COPY --chown=node:node packages/express-static-serve/scripts packages/express-static-serve/scripts
COPY --chown=node:node packages/express-static-serve/views packages/express-static-serve/views

# 1000:1000 is the `node` user of the official image; a numeric id also works with
# runAsNonRoot checks on orchestrators.
USER 1000:1000
EXPOSE 3000

# GET / is the health check and answers even when dist/ is missing. The script is too long for
# the exec form within the 100 character line limit.
# hadolint ignore=DL3025
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/') \
    .then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Same flag as the PM2 ecosystem file. Do not add --permission (see CLAUDE.md, PM2 worker flags).
CMD ["node", "--disable-proto=delete", "packages/express-static-serve/server.js"]
