#!/usr/bin/env bash
# ==============================================================================
# CommanderDog - LXC / Bare-Metal Automated Installer
# Supported: Debian 11/12, Ubuntu 22.04/24.04, Proxmox LXC Containers
# ==============================================================================

set -euo pipefail

echo "======================================================"
echo "Installing CommanderDog on Linux / Proxmox LXC..."
echo "======================================================"

# 1. Install prerequisites
echo "📦 Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
    curl \
    ca-certificates \
    libssl-dev \
    libssh2-1 \
    libsqlite3-0 \
    tar \
    gzip \
    bzip2 \
    p7zip-full \
    openssh-client

# 2. Setup directory hierarchy
echo "📁 Configuring /etc/commanderdog and /data..."
mkdir -p /etc/commanderdog /data /var/log/commanderdog

# 3. Copy binary and configs
if [ -f "./target/release/commanderdog" ]; then
    cp ./target/release/commanderdog /usr/local/bin/commanderdog
    cp ./config.toml /etc/commanderdog/config.toml
    if [ -f "./commanderdog.service" ]; then
        cp ./commanderdog.service /etc/systemd/system/commanderdog.service
    fi
fi

chmod +x /usr/local/bin/commanderdog

# 4. Enable and start systemd service
if command -v systemctl >/dev/null 2>&1; then
    echo "⚙️ Enabling and starting systemd service..."
    systemctl daemon-reload
    systemctl enable --now commanderdog.service
    echo "✅ CommanderDog is running and enabled on boot!"
    echo "🌐 Access via: http://$(hostname -I | awk '{print $1}'):3140"
fi
