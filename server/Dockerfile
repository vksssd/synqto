# ─── Multi-Stage Dockerfile for Nerd Buddy Go Signaling Server ───

# 1. Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Download Go modules
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-w -s" -o /nerd-buddy-server .

# 2. Production stage (Ultra-minimal scratch container)
FROM alpine:3.19

WORKDIR /root/

# Install CA certificates for secure TLS/WSS
RUN apk --no-cache add ca-certificates tzdata

COPY --from=builder /nerd-buddy-server /usr/local/bin/nerd-buddy-server

EXPOSE 8080

ENV PORT=8080

CMD ["/usr/local/bin/nerd-buddy-server"]
