# Stage 1: Build CommanderDog binary
FROM rust:1.80-slim-bullseye AS builder

WORKDIR /usr/src/commanderdog

# Install build dependencies (openssl, libssh2, sqlite, pam, pkg-config)
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    libssh2-1-dev \
    libsqlite3-dev \
    libpam0g-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY frontend ./frontend
COPY conf.d ./conf.d

RUN cargo build --release

# Stage 2: Minimal runtime image
FROM debian:bullseye-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    bash \
    coreutils \
    procps \
    libssl1.1 \
    libssh2-1 \
    libsqlite3-0 \
    libpam0g \
    tar \
    gzip \
    bzip2 \
    p7zip-full \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy release binary and default conf.d
COPY --from=builder /usr/src/commanderdog/target/release/commanderdog /usr/local/bin/commanderdog
COPY --from=builder /usr/src/commanderdog/conf.d /etc/commanderdog/conf.d

# Setup storage directory
RUN mkdir -p /data

EXPOSE 8080

ENV RUST_LOG=commanderdog=info,tower_http=info

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/api/config || exit 1

ENTRYPOINT ["/usr/local/bin/commanderdog"]
