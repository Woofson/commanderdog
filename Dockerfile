# Stage 1: Build CommanderDog binary
FROM rust:1.80-slim-bullseye AS builder

WORKDIR /usr/src/commanderdog

# Install build dependencies (openssl, libssh2, sqlite, pam)
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
    libssl1.1 \
    libssh2-1 \
    libsqlite3-0 \
    libpam0g \
    tar \
    bzip2 \
    p7zip-full \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /usr/src/commanderdog/target/release/commanderdog /usr/local/bin/commanderdog
COPY --from=builder /usr/src/commanderdog/conf.d /etc/commanderdog/conf.d

EXPOSE 8080

ENV RUST_LOG=commanderdog=info,tower_http=info

ENTRYPOINT ["/usr/local/bin/commanderdog"]
