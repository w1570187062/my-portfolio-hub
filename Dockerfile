# 前端阶段：只搬运本地预构建好的 web/dist，服务器上不跑 npm（免联网、免 node 镜像）。
# 本地需先 `cd web && npm run build`，否则这里直接报错退出。
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
ENV GOTOOLCHAIN=local
# 依赖层：模块靠镜像层缓存持久（go.mod/go.sum 不变即 CACHED）。
# 不要加 --mount=type=cache,target=/go/pkg/mod：本机 BuildKit 的 cache mount 会被 --no-cache 清空，
# 且空挂载会遮住层里的模块。也不要加 go mod tidy（会拉 modernc.org/z 等非构建依赖）。
COPY go.mod go.sum ./
RUN go mod download
COPY internal ./internal
COPY main.go ./
COPY web ./web
COPY --from=fe /fe/web/dist ./web/dist
# VERSION 不入库：构建时按 git HEAD + UTC 时间生成，格式 "commit|commitTime"；无 git 回退 "dev"。
RUN --mount=type=cache,target=/root/.cache/go-build \
    H=$(git rev-parse --short HEAD 2>/dev/null || echo "dev") && \
    V="${H}|$(date -u +%Y-%m-%dT%H:%M:%SZ)" && \
    echo "$V" > VERSION && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags "-X 'portfolio/internal/api.BuildInfo=$V'" -o /out/app .

FROM alpine:3.20
RUN sed -i 's#dl-cdn.alpinelinux.org#mirrors.tuna.tsinghua.edu.cn#g' /etc/apk/repositories && \
    apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /out/app .
ENV PORT=9989
ENV DATA_DIR=/data/portfolio.db
ENV TZ=Asia/Shanghai
EXPOSE 9989
VOLUME ["/data"]
CMD ["/app/app"]
