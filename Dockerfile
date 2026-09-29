# syntax=docker/dockerfile:1

# 构建阶段：校验并产出静态站点 dist/
FROM node:22-alpine AS build
WORKDIR /src
COPY scripts/build.js scripts/build.js
COPY web/ web/
RUN node scripts/build.js

# 运行阶段：nginx 托管静态文件，提供 /healthz 健康检查
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
