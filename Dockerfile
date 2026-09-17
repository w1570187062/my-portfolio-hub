# 前端构建：优先使用已预构建的 web/dist（同步时一并上传，免服务器 npm 联网）；
# 若缺失则现场 npm install + build 兜底。
FROM node:20-alpine AS fe
WORKDIR /fe
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
COPY web ./web
RUN if [ -f web/dist/app.js ] && [ -f web/dist/style.css ]; then \
      echo "prebuilt web/dist found, skip npm build"; \
    else \
      cd web && npm install && npm run build; \
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
COPY VERSION ./
RUN --mount=type=cache,target=/go/pkg/mod \
    V=$(tr -d '\r\n ' < VERSION) && \
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
