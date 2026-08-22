# 🗺️ CommanderDog Roadmap & Future Backlog

## 📋 Backlog / Planned Features

### 🔑 1. OAuth2 / OIDC Single Sign-On (SSO)
- Integration with OpenID Connect (OIDC) identity providers:
  - **Authentik**
  - **Authelia**
  - **Keycloak**
  - **Google / GitHub / Generic OAuth2 Provider**
- Group-to-role mapping (mapping OIDC groups to CommanderDog admin/editor/read-only roles).
- Automatic user provisioning upon initial login.

### 🔄 2. Syncthing Native Integration
- REST API & Event listener integration with local and remote **Syncthing** daemons.
- Real-time sync status badges on synchronized folders and files.
- Connected peer devices overview and live transfer speed metrics.
- 1-Click trigger for manual folder rescans and visual sync conflict resolution within panes.

### 🛡️ 3. Proton Drive Integration (via Proton Drive CLI)
- VFS adapter leveraging the official **Proton Drive CLI** tool.
- End-to-end encrypted (E2EE) zero-knowledge cloud file storage mounted directly into CommanderDog panels.
- Browse, stream, download, upload, and sync Proton Drive files and folders seamlessly alongside local and remote VFS.

### 🧩 4. Plugin & Custom Extension API
- WASM / Rust dynamic plugins for file format viewers and custom tools.
- Webhook triggers on file upload, move, or deletion events.

### 📦 5. Native Package Repository Releases
- Debian `.deb` package generation via `cargo-deb`.
- Arch Linux `PKGBUILD` and AUR package.
- Alpine `.apk` package.
