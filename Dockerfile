# Stage 1: Web-Build (React PWA)
FROM node:24-bookworm-slim AS web-build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Server-Build (Fastify/TS)
FROM node:24-bookworm-slim AS server-build
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# Stage 3: Runtime
# sql.js is pure WASM — no native modules, works on any glibc/musl base image
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/app/data/taskmaster.db
ENV JWT_SECRET=changeme
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=server-build /app/dist ./dist
COPY --from=server-build /app/src/db/migrations ./src/db/migrations
COPY --from=web-build /app/dist ./public
RUN mkdir -p /app/data
EXPOSE 8080
CMD ["node", "dist/index.js"]
