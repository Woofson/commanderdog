# CommanderDog — Official Ultra-Minimal Container Image (Alpine Linux 3.20)
FROM alpine:3.20

LABEL org.opencontainers.image.title="CommanderDog" \
      org.opencontainers.image.description="Multi-Tab Web File Commander - By Woofson" \
      org.opencontainers.image.vendor="Woofsons Lab" \
      org.opencontainers.image.url="https://www.arf.ac" \
      org.opencontainers.image.source="https://github.com/woofson/commanderdog" \
      org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache \
    ca-certificates \
    curl \
    bash \
    coreutils \
    procps \
    libssl3 \
    libcrypto3 \
    libssh2 \
    sqlite-libs \
    zlib \
    bzip2 \
    tar \
    gzip \
    7zip \
    openssh-client \
    tzdata

WORKDIR /app

# Copy compiled musl release binary and master config.toml
COPY target/x86_64-unknown-linux-musl/release/commanderdog /usr/local/bin/commanderdog
COPY config.toml /etc/commanderdog/config.toml

# Setup storage and runtime directories
RUN mkdir -p /data /mnt

EXPOSE 3140

ENV RUST_LOG=commanderdog=info,tower_http=info

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3140/api/system/status || exit 1

ENTRYPOINT ["/usr/local/bin/commanderdog"]
