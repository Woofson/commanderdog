use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub nickname: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub role: String, // "admin", "user", "readonly"
    pub home_dir: String,
    pub is_pam: bool,
    pub allowed_services: String, // JSON array e.g. ["*"] or ["local","smb","s3"]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalMount {
    pub id: i64,
    pub name: String,
    pub protocol: String,
    pub target_uri: String,
    pub options_json: String,
    pub allowed_users: String, // JSON array e.g. ["*"] or ["bolt", "alice"]
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub role: String,
    pub home_dir: String,
    pub is_pam: bool,
    pub exp: i64,
}

pub struct AuthManager {
    db: Arc<Mutex<Connection>>,
    jwt_secret: String,
    session_hours: u64,
    auth_mode: String,
    #[allow(dead_code)]
    pam_service: String,
}

impl AuthManager {
    pub fn new(
        db_path: &str,
        jwt_secret: &str,
        session_hours: u64,
        auth_mode: &str,
        pam_service: &str,
        default_admin_user: &str,
        default_admin_pass: &str,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let conn = Connection::open(db_path)?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                home_dir TEXT NOT NULL DEFAULT '/',
                nickname TEXT,
                email TEXT,
                avatar_url TEXT,
                allowed_services TEXT DEFAULT '[\"*\"]',
                is_pam INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS global_mounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                protocol TEXT NOT NULL,
                target_uri TEXT NOT NULL,
                options_json TEXT DEFAULT '{}',
                allowed_users TEXT DEFAULT '[\"*\"]',
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        // Safe migrations for newly added columns
        let _ = conn.execute("ALTER TABLE users ADD COLUMN nickname TEXT", []);
        let _ = conn.execute("ALTER TABLE users ADD COLUMN email TEXT", []);
        let _ = conn.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT", []);
        let _ = conn.execute("ALTER TABLE users ADD COLUMN allowed_services TEXT DEFAULT '[\"*\"]'", []);
        let _ = conn.execute("ALTER TABLE users ADD COLUMN is_pam INTEGER DEFAULT 0", []);

        let auth = Self {
            db: Arc::new(Mutex::new(conn)),
            jwt_secret: jwt_secret.to_string(),
            session_hours,
            auth_mode: auth_mode.to_string(),
            pam_service: pam_service.to_string(),
        };

        // Seed default admin user if database is empty
        if auth.count_users()? == 0 {
            info!("No users found in database. Creating default admin user: {}", default_admin_user);
            auth.create_user(default_admin_user, default_admin_pass, "admin", "/")?;
        }

        Ok(auth)
    }

    pub fn count_users(&self) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM users")?;
        let count: i64 = stmt.query_row([], |row| row.get(0))?;
        Ok(count as usize)
    }

    pub fn create_user(
        &self,
        username: &str,
        password: &str,
        role: &str,
        home_dir: &str,
    ) -> Result<User, Box<dyn std::error::Error + Send + Sync>> {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let password_hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| format!("Password hashing failed: {}", e))?
            .to_string();

        let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO users (username, password_hash, role, home_dir, allowed_services, is_pam, created_at) VALUES (?1, ?2, ?3, ?4, '[\"*\"]', 0, ?5)",
            params![username, password_hash, role, home_dir, now],
        )?;

        let id = conn.last_insert_rowid();

        Ok(User {
            id,
            username: username.to_string(),
            nickname: None,
            email: None,
            avatar_url: None,
            role: role.to_string(),
            home_dir: home_dir.to_string(),
            is_pam: false,
            allowed_services: "[\"*\"]".to_string(),
        })
    }

    pub fn get_user_by_username(&self, username: &str) -> Result<Option<User>, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
        let mut stmt = conn.prepare(
            "SELECT id, username, nickname, email, avatar_url, role, home_dir, is_pam, allowed_services FROM users WHERE username = ?1"
        )?;

        let user = stmt.query_row(params![username], |row| {
            Ok(User {
                id: row.get(0)?,
                username: row.get(1)?,
                nickname: row.get(2)?,
                email: row.get(3)?,
                avatar_url: row.get(4)?,
                role: row.get(5)?,
                home_dir: row.get(6)?,
                is_pam: row.get::<_, i64>(7)? != 0,
                allowed_services: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "[\"*\"]".to_string()),
            })
        }).optional()?;

        Ok(user)
    }

    pub fn list_users(&self) -> Result<Vec<User>, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
        let mut stmt = conn.prepare(
            "SELECT id, username, nickname, email, avatar_url, role, home_dir, is_pam, allowed_services FROM users ORDER BY username ASC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(User {
                id: row.get(0)?,
                username: row.get(1)?,
                nickname: row.get(2)?,
                email: row.get(3)?,
                avatar_url: row.get(4)?,
                role: row.get(5)?,
                home_dir: row.get(6)?,
                is_pam: row.get::<_, i64>(7)? != 0,
                allowed_services: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "[\"*\"]".to_string()),
            })
        })?;

        let mut users = Vec::new();
        for user in rows {
            users.push(user?);
        }
        Ok(users)
    }

    pub fn sync_pam_user_to_db(
        &self,
        username: &str,
        role: &str,
        home_dir: &str,
    ) -> Result<User, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO users (username, password_hash, role, home_dir, nickname, allowed_services, is_pam, created_at)
             VALUES (?1, 'PAM_MANAGED', ?2, ?3, ?1, '[\"*\"]', 1, ?4)
             ON CONFLICT(username) DO UPDATE SET is_pam = 1",
            params![username, role, home_dir, now],
        )?;

        drop(conn);
        self.get_user_by_username(username)?
            .ok_or_else(|| "Failed to retrieve synced PAM user".into())
    }

    pub fn update_user_profile(
        &self,
        username: &str,
        nickname: Option<&str>,
        email: Option<&str>,
        avatar_url: Option<&str>,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
        let affected = conn.execute(
            "UPDATE users SET nickname = ?1, email = ?2, avatar_url = ?3 WHERE username = ?4",
            params![nickname, email, avatar_url, username],
        )?;
        Ok(affected > 0)
    }

    pub fn update_user_password(
        &self,
        username: &str,
        new_password: &str,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let password_hash = argon2
            .hash_password(new_password.as_bytes(), &salt)
            .map_err(|e| format!("Password hashing failed: {}", e))?
            .to_string();

        let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
        let affected = conn.execute(
            "UPDATE users SET password_hash = ?1 WHERE username = ?2",
            params![password_hash, username],
        )?;
        Ok(affected > 0)
    }

    pub fn update_user_rbac(
        &self,
        username: &str,
        role: &str,
        allowed_services: &str,
        home_dir: Option<&str>,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
        let affected = if let Some(hd) = home_dir {
            conn.execute(
                "UPDATE users SET role = ?1, allowed_services = ?2, home_dir = ?3 WHERE username = ?4",
                params![role, allowed_services, hd, username],
            )?
        } else {
            conn.execute(
                "UPDATE users SET role = ?1, allowed_services = ?2 WHERE username = ?3",
                params![role, allowed_services, username],
            )?
        };
        Ok(affected > 0)
    }

    pub fn delete_user(&self, username: &str) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
        let affected = conn.execute("DELETE FROM users WHERE username = ?1", params![username])?;
        Ok(affected > 0)
    }

    pub fn authenticate(
        &self,
        username: &str,
        password: &str,
    ) -> Result<User, Box<dyn std::error::Error + Send + Sync>> {
        // 1. If auth mode is mixed or builtin, try builtin DB first
        if self.auth_mode == "builtin" || self.auth_mode == "mixed" {
            let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
            let mut stmt = conn.prepare(
                "SELECT id, username, password_hash, role, home_dir, nickname, email, avatar_url, allowed_services, is_pam FROM users WHERE username = ?1"
            )?;
            let user_res = stmt.query_row(params![username], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "[\"*\"]".to_string()),
                    row.get::<_, i64>(9)? != 0,
                ))
            });

            if let Ok((id, uname, hash_str, role, home_dir, nickname, email, avatar_url, allowed_services, is_pam)) = user_res {
                let parsed_hash = PasswordHash::new(&hash_str)
                    .map_err(|e| format!("Corrupt password hash: {}", e))?;
                if Argon2::default().verify_password(password.as_bytes(), &parsed_hash).is_ok() {
                    return Ok(User {
                        id,
                        username: uname,
                        nickname,
                        email,
                        avatar_url,
                        role,
                        home_dir,
                        is_pam,
                        allowed_services,
                    });
                }
            }
        }

        // 2. If auth mode is mixed or pam, try PAM authentication
        if self.auth_mode == "pam" || self.auth_mode == "mixed" {
            #[cfg(feature = "pam")]
            {
                if let Some(mut auth) = pam_auth::Authenticator::new(&self.pam_service) {
                    auth.set_credentials(username, password);
                    if auth.authenticate().is_ok() {
                        let (home_dir, def_role) = get_linux_user_info(username);
                        
                        // Check if this PAM user already has a linked DB record
                        if let Ok(Some(existing)) = self.get_user_by_username(username) {
                            return Ok(existing);
                        }

                        // Auto-link new PAM user to DB profile
                        let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
                        let now = Utc::now().to_rfc3339();
                        let _ = conn.execute(
                            "INSERT OR IGNORE INTO users (username, password_hash, role, home_dir, allowed_services, is_pam, created_at) VALUES (?1, 'PAM_MANAGED', ?2, ?3, '[\"*\"]', 1, ?4)",
                            params![username, def_role, home_dir, now],
                        );
                        let id = conn.last_insert_rowid();

                        return Ok(User {
                            id,
                            username: username.to_string(),
                            nickname: Some(username.to_string()),
                            email: None,
                            avatar_url: None,
                            role: def_role,
                            home_dir,
                            is_pam: true,
                            allowed_services: "[\"*\"]".to_string(),
                        });
                    }
                }
            }
        }

        Err("Invalid username or password".into())
    }

    pub fn generate_token(&self, user: &User) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let expiration = Utc::now()
            .checked_add_signed(Duration::hours(self.session_hours as i64))
            .expect("valid timestamp")
            .timestamp();

        let claims = Claims {
            sub: user.username.clone(),
            role: user.role.clone(),
            home_dir: user.home_dir.clone(),
            is_pam: user.is_pam,
            exp: expiration,
        };

        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.jwt_secret.as_bytes()),
        )?;

        Ok(token)
    }

    pub fn verify_token(&self, token: &str) -> Result<Claims, Box<dyn std::error::Error + Send + Sync>> {
        let token_data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(self.jwt_secret.as_bytes()),
            &Validation::default(),
        )?;

        Ok(token_data.claims)
    }

    pub fn list_accessible_mounts(
        &self,
        username: &str,
        is_admin: bool,
    ) -> Result<Vec<GlobalMount>, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
        let mut stmt = conn.prepare("SELECT id, name, protocol, target_uri, options_json, allowed_users, created_at FROM global_mounts ORDER BY name ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(GlobalMount {
                id: row.get(0)?,
                name: row.get(1)?,
                protocol: row.get(2)?,
                target_uri: row.get(3)?,
                options_json: row.get(4)?,
                allowed_users: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;

        let mut accessible = Vec::new();
        for r in rows {
            let m = r?;
            if is_admin {
                accessible.push(m);
            } else {
                let allowed: Vec<String> = serde_json::from_str(&m.allowed_users).unwrap_or_else(|_| vec!["*".to_string()]);
                if allowed.contains(&"*".to_string()) || allowed.iter().any(|u| u.eq_ignore_ascii_case(username)) {
                    accessible.push(m);
                }
            }
        }

        Ok(accessible)
    }

    pub fn list_all_mounts(&self) -> Result<Vec<GlobalMount>, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
        let mut stmt = conn.prepare("SELECT id, name, protocol, target_uri, options_json, allowed_users, created_at FROM global_mounts ORDER BY name ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(GlobalMount {
                id: row.get(0)?,
                name: row.get(1)?,
                protocol: row.get(2)?,
                target_uri: row.get(3)?,
                options_json: row.get(4)?,
                allowed_users: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;

        let mut all = Vec::new();
        for r in rows {
            all.push(r?);
        }
        Ok(all)
    }

    pub fn create_or_update_mount(
        &self,
        name: &str,
        protocol: &str,
        target_uri: &str,
        options_json: &str,
        allowed_users: &str,
    ) -> Result<GlobalMount, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO global_mounts (name, protocol, target_uri, options_json, allowed_users, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![name, protocol, target_uri, options_json, allowed_users, now],
        )?;

        let id = conn.last_insert_rowid();

        Ok(GlobalMount {
            id,
            name: name.to_string(),
            protocol: protocol.to_string(),
            target_uri: target_uri.to_string(),
            options_json: options_json.to_string(),
            allowed_users: allowed_users.to_string(),
            created_at: now,
        })
    }

    pub fn delete_mount(&self, id: i64) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
        conn.execute("DELETE FROM global_mounts WHERE id = ?1", params![id])?;
        Ok(())
    }
}

pub fn get_linux_user_info(username: &str) -> (String, String) {
    let mut home_dir = format!("/home/{}", username);
    let mut is_admin = username == "root";

    if let Ok(passwd) = std::fs::read_to_string("/etc/passwd") {
        for line in passwd.lines() {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() >= 6 && parts[0] == username {
                home_dir = parts[5].to_string();
                break;
            }
        }
    }

    if let Ok(group) = std::fs::read_to_string("/etc/group") {
        for line in group.lines() {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() >= 4 {
                let grp_name = parts[0];
                let members: Vec<&str> = parts[3].split(',').map(|s| s.trim()).collect();
                if (grp_name == "sudo" || grp_name == "wheel" || grp_name == "admin" || grp_name == "root")
                    && (members.contains(&username) || grp_name == username)
                {
                    is_admin = true;
                }
            }
        }
    }

    let role = if is_admin { "admin".to_string() } else { "user".to_string() };
    (home_dir, role)
}
