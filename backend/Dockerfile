# syntax=docker/dockerfile:1
# ==============================================================================
# Stage 1: Build binary with BuildKit module & compiler cache
# ==============================================================================
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Cache Go modules layer separately
COPY go.mod go.sum* ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

# Copy source code and build using compiler caches
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod tidy && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/bin/server ./cmd/server && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/bin/worker ./cmd/worker

# ==============================================================================
# Stage 2: Server Runtime (API Server)
# ==============================================================================
FROM alpine:3.19 AS server

WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata curl

COPY --from=builder /app/bin/server /app/server

EXPOSE 8080
ENTRYPOINT ["/app/server"]

# ==============================================================================
# Stage 3: Worker Runtime (Transcoder with FFmpeg, Mediainfo, libvips)
# ==============================================================================
FROM alpine:3.19 AS worker

WORKDIR /app
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    curl \
    ffmpeg \
    mediainfo \
    vips-tools \
    vips

COPY --from=builder /app/bin/worker /app/worker

ENTRYPOINT ["/app/worker"]
