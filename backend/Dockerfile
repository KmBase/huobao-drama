# Vercel Services 容器形态 — backend 单服务镜像（非 docker-compose 全栈镜像，见仓库根 Dockerfile）
# 数据库走 Turso（DATABASE_URL/TURSO_DATABASE_URL），媒体走 Vercel Blob（HUOBAO_SERVERLESS=1），
# 容器内无 ffmpeg，成片导出能力与 serverless 一致（capabilities 协商降级）。
FROM node:22-slim
WORKDIR /app

ENV NODE_ENV=production \
    HUOBAO_DATA_DIR=/app/data \
    WORKSPACE_PATH=/app/workspace

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
COPY workspace ./workspace
RUN mkdir -p data

EXPOSE 5679
CMD ["npx", "tsx", "src/index.ts"]
