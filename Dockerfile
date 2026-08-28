# CommanderDog — Official Minimal Container Image (Debian 12 Bookworm Slim)
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    bash \
    coreutils \
    procps \
    libssl3 \
    libssh2-1 \
    libsqlite3-0 \
    libpam0g \
    zlib1g \
    libbz2-1.0 \
    tar \
    gzip \
    bzip2 \
    p7zip-full \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy compiled Debian Bookworm binary and config.toml
COPY target/release/commanderdog /usr/local/bin/commanderdog
COPY config.toml /etc/commanderdog/config.toml

# Setup storage and runtime directories
RUN mkdir -p /data /mnt

EXPOSE 3140

ENV RUST_LOG=commanderdog=info,tower_http=info

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3140/api/system/status || exit 1

ENTRYPOINT ["/usr/local/bin/commanderdog"]
