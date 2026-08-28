# Stage 1: Build CommanderDog binary on Debian Bookworm
FROM rust:1.85-bookworm AS builder

WORKDIR /usr/src/commanderdog

# Install build dependencies (openssl, libssh2, sqlite, pam, zlib, bz2, cmake, pkg-config)
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    libssh2-1-dev \
    libsqlite3-dev \
    libpam0g-dev \
    zlib1g-dev \
    libbz2-dev \
    cmake \
    clang \
    build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/lib/x86_64-linux-gnu \
    && (ln -sf /lib/x86_64-linux-gnu/libpam.so.0 /usr/lib/x86_64-linux-gnu/libpam.so || true) \
    && (ln -sf /lib/x86_64-linux-gnu/libpam_misc.so.0 /usr/lib/x86_64-linux-gnu/libpam_misc.so || true)

COPY Cargo.toml Cargo.lock build.rs config.toml ./
COPY src ./src
COPY frontend ./frontend

# Build release binary on Debian Bookworm
RUN cargo build --release --features pam

# Stage 2: Minimal runtime image on Debian Bookworm Slim
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

# Copy release binary and master config.toml from builder stage
COPY --from=builder /usr/src/commanderdog/target/release/commanderdog /usr/local/bin/commanderdog
COPY --from=builder /usr/src/commanderdog/config.toml /etc/commanderdog/config.toml

# Setup storage and runtime directories
RUN mkdir -p /data /mnt

EXPOSE 3140

ENV RUST_LOG=commanderdog=info,tower_http=info

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3140/api/system/status || exit 1

ENTRYPOINT ["/usr/local/bin/commanderdog"]
