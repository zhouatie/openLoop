# openLoop 多阶段容器化部署 Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app

# 启用 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 安装构建依赖 (better-sqlite3 等原生 Node 扩展编译环境)
RUN apk add --no-cache python3 make g++ git

# 拷贝 workspace 依赖声明
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/cli/package.json ./packages/cli/
COPY packages/desktop/package.json ./packages/desktop/

# 安装全量依赖
RUN pnpm install --frozen-lockfile

# 拷贝全量源码
COPY . .

# 生产环境全量编译构建
RUN pnpm build

# 生产运行阶段
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV OPENLOOP_HOST=0.0.0.0
ENV OPENLOOP_PORT=19888

RUN apk add --no-cache curl bash

# 拷贝构建好的全量产物与 node_modules
COPY --from=builder /app /app

EXPOSE 19888

# 持久化 SQLite 数据目录
VOLUME ["/root/.openloop"]

# 生产服务健康检查探针
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fs http://127.0.0.1:19888/api/status || exit 1

# 启动 openLoop 核心全栈生产服务 (单端口 19888 同时托管 API、WebSocket 与 Web 前端)
CMD ["node", "packages/core/dist/server-cli.js"]
