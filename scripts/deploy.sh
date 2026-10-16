#!/usr/bin/env bash
set -e

# openLoop 生产应用一键部署脚本
echo -e "\033[1;34m[openLoop Deploy]\033[0m 开始全自动化应用构建与部署..."

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# 1. 检查 Node.js 与 pnpm 运行环境
echo -e "\033[1;36m[Step 1/4]\033[0m 检查运行时环境..."
node -v || { echo -e "\033[1;31m[Error]\033[0m 未检测到 Node.js 环境"; exit 1; }
pnpm -v || { echo -e "\033[1;31m[Error]\033[0m 未检测到 pnpm 包管理器"; exit 1; }

# 2. 清理端口状态
echo -e "\033[1;36m[Step 2/4]\033[0m 清理端口状态..."
node scripts/clean-ports.js || true

# 3. 构建全量工程产物
if [ "$1" != "--skip-build" ]; then
  echo -e "\033[1;36m[Step 3/4]\033[0m 执行生产环境全量编译构建 (pnpm build)..."
  pnpm build
else
  echo -e "\033[1;36m[Step 3/4]\033[0m 跳过编译构建阶段 (--skip-build)"
fi

# 4. 验证构建产物完整性
echo -e "\033[1;36m[Step 4/4]\033[0m 检查发布产物完整性..."
if [ ! -f "packages/core/dist/server-cli.js" ]; then
  echo -e "\033[1;31m[Error]\033[0m 核心调度服务产物缺失: packages/core/dist/server-cli.js"
  exit 1
fi
if [ ! -f "packages/desktop/dist/index.html" ]; then
  echo -e "\033[1;31m[Error]\033[0m 前端 Web 静态产物缺失: packages/desktop/dist/index.html"
  exit 1
fi

echo -e "\033[1;32m✔ [openLoop Deploy]\033[0m 应用部署与生产产物就绪！"
echo -e "可通过以下命令启动生产服务 (Core 将同时托管 API 与前端 Web 界面):"
echo -e "  \033[1;33mpnpm start:prod\033[0m (默认监听端口: 19888, 浏览器访问: http://localhost:19888)"
