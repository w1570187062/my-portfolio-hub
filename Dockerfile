FROM golang:1.22-alpine AS build
WORKDIR /src
ENV GOPROXY=https://goproxy.cn,direct
ENV GOSUMDB=off
COPY go.mod ./
COPY internal ./internal
COPY main.go ./
COPY web ./web
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o /out/app .

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
