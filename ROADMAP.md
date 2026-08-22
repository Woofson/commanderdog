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

### 🧩 2. Plugin & Custom Extension API
- WASM / Rust dynamic plugins for file format viewers and custom tools.
- Webhook triggers on file upload, move, or deletion events.

### 📦 3. Native Package Repository Releases
- Debian `.deb` package generation via `cargo-deb`.
- Arch Linux `PKGBUILD` and AUR package.
- Alpine `.apk` package.
