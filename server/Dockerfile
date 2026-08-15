# ─── High-Throughput Ultra-Minimal Dockerfile for Free Fly.io ───

# 1. Build stage with latest Go optimizations
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git ca-certificates

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build stripped static binary with aggressive inlining and zero debug bloat
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s -extldflags '-static'" \
    -trimpath \
    -o /synqto-server .

# 2. Ultra-lean Scratch/Alpine production stage
FROM alpine:3.21

WORKDIR /app

RUN apk --no-cache add ca-certificates tzdata

COPY --from=builder /synqto-server /usr/local/bin/synqto-server

EXPOSE 8080

# Environment optimization for free Fly.io (256MB RAM shared CPU)
ENV PORT=8080 \
    GOMEMLIMIT=220MiB \
    GOGC=60 \
    GODEBUG="netdns=cgo"

CMD ["/usr/local/bin/synqto-server"]
