# 🐳 CommanderDog — Docker & Portainer Deployment Guide

> Complete walkthrough for deploying **CommanderDog** with **Docker**, **Docker Compose**, and **Portainer Stacks**.

---

## 🌟 Why Run CommanderDog in Docker?

- ⚡ **Ultra-Lightweight**: Rust binary based on Debian/Alpine slim, using only **~25 MB of RAM**.
- 🔒 **Isolated & Secure**: Run in rootless/isolated containers with fine-grained host volume bind-mounts.
- 🗄️ **Multi-Host Storage Management**: Mount `/mnt/storage`, `/mnt/nas`, USB drives, or NFS directly into CommanderDog.
- 🔄 **Zero Maintenance**: Automatic healthchecks and simple 1-command upgrades.

---

## 🚀 1. Quick Start via Docker CLI

Run CommanderDog directly with a single command:

```bash
docker run -d \
  --name commanderdog \
  --restart unless-stopped \
  -p 3140:3140 \
  -v commanderdog_data:/data \
  -v /home:/mnt/home:rw \
  -v /mnt:/mnt/storage:rw \
  ghcr.io/woofson/commanderdog:latest
```

Open `http://<SERVER_IP>:3140` in your browser:
- **Default Username**: `admin`
- **Default Password**: `commanderdog` *(Change immediately in Settings > Security!)*

---

## 📦 2. Deployment via Docker Compose

### Step 1: Create `docker-compose.yml`
```yaml
version: '3.8'

services:
  commanderdog:
    image: ghcr.io/woofson/commanderdog:latest
    container_name: commanderdog
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - TZ=Europe/Oslo
      - CD_PORT=8080
      - CD_BIND=0.0.0.0
    volumes:
      # Data & Configuration persistence
      - ./data:/data
      - ./config.toml:/etc/commanderdog/config.toml:ro
      
      # Host Storage / Shares (Adjust to your host paths)
      - /home:/mnt/home:rw
      - /mnt:/mnt/storage:rw
      - /media:/mnt/media:rw
      
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8080/ || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    
    security_opt:
      - no-new-privileges:true
```

### Step 2: Start the Service
```bash
docker compose up -d
```

### Step 3: View Logs & Update
```bash
# View live logs
docker compose logs -f commanderdog

# Upgrade to latest release
docker compose pull
docker compose up -d --force-recreate
```

---

## 🎛️ 3. Deployment via Portainer Stacks

1. Open **Portainer** $\rightarrow$ Navigate to your Environment $\rightarrow$ **Stacks** $\rightarrow$ **Add stack**.
2. Name the stack: `commanderdog`.
3. Select **Web editor** and paste the contents of [`portainer-stack.yaml`](file:///home/bolt/projects/commanderdog/portainer-stack.yaml):
4. Click **Deploy the stack**.
5. Access CommanderDog on port `3140`.

---

## 🔒 4. Reverse Proxy Integration (Traefik, Nginx, Caddy)

### Caddy
```caddy
commanderdog.example.com {
    reverse_proxy commanderdog:3140
}
```

### Nginx Proxy Manager / Nginx
```nginx
location / {
    proxy_pass http://127.0.0.1:3140;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```
