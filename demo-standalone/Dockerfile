# GymSystem Demo Standalone — Cloud Dockerfile
# Optimized for free cloud hosting (Render.com / Railway / Fly.io)

FROM node:24-alpine AS builder

WORKDIR /app
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV GYMSYSTEM_HOST=0.0.0.0
ENV GYMSYSTEM_PORT=8890
ENV GYMSYSTEM_NO_OPEN=1
ENV GYM_SEED_DEMO=1

COPY package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 8890

CMD ["node", "dist-server/index.cjs"]
