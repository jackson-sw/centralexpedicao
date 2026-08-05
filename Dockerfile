# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
# Etapa 1 — deps: instala as dependências do backend.
# Precisa de python3/make/g++ porque "bcrypt" compila um binário nativo.
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app/backend
COPY backend/package*.json ./
# package-lock.json já está commitado — "npm ci" garante build 100% reprodutível.
RUN npm ci --omit=dev

# ─────────────────────────────────────────────────────────────
# Etapa 2 — runtime: imagem final, sem ferramentas de build.
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

# Código do backend e do frontend (servido estaticamente pelo Express)
COPY --chown=node:node backend ./backend
COPY --chown=node:node frontend ./frontend

# node_modules já compilados na etapa anterior
COPY --from=deps --chown=node:node /app/backend/node_modules ./backend/node_modules

USER node
WORKDIR /app/backend
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/api/health || exit 1

CMD ["node", "server.js"]
