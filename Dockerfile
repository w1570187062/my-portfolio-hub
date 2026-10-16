# 前端构建：优先使用已预构建的 web/dist（同步时一并上传，免服务器 npm 联网）。
# fe 阶段仅负责搬运 web/dist，不需要 node 运行时；用已缓存的 alpine 作基础，
# 避免路由器到 Docker Hub 拉取 node:20-alpine（~43MB，出口被限速到 KB/s 级）。
# 若本地未预构建 dist，需先在本地 `cd web && npm run build` 再上传。
FROM alpine:3.20 AS fe
WORKDIR /fe
COPY web ./web
RUN if [ -f web/dist/app.js ] && [ -f web/dist/style.css ]; then \
      echo "prebuilt web/dist found, skip npm build"; \
    else \
      echo "ERROR: web/dist 未预构建，请在本地 npm run build 后重新上传" && exit 1; \
    fi

FROM golang:1.25-alpine AS build
WORKDIR /src
ENV GOPROXY=https://goproxy.cn,direct
ENV GOSUMDB=off
COPY go.mod ./
COPY internal ./internal
COPY main.go ./
COPY web ./web
COPY --from=fe /fe/web/dist ./web/dist
# VERSION 不入库（部署产物）：构建时按 git HEAD + UTC 时间自动生成，格式 "commit|commitTime"（与 /api/version、缓存戳一致）。
# 无 git 时回退 "dev"，保证本地无仓库也能构建。
RUN H=$(git rev-parse --short HEAD 2>/dev/null || echo "dev") && \
    V="${H}|$(date -u +%Y-%m-%dT%H:%M:%SZ)" && \
    echo "$V" > VERSION && \
    go mod tidy && CGO_ENABLED=0 GOOS=linux go build -ldflags "-X 'portfolio/internal/api.BuildInfo=$V'" -o /out/app .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /out/app .
ENV PORT=9989
ENV DATA_DIR=/data/portfolio.db
ENV TZ=Asia/Shanghai
EXPOSE 9989
VOLUME ["/data"]
CMD ["/app/app"]
