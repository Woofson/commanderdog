use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub role: String, // "admin", "user", "readonly"
    pub home_dir: String,
    pub is_pam: bool,
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
                created_at TEXT NOT NULL
            )",
            [],
        )?;

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
            "INSERT INTO users (username, password_hash, role, home_dir, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![username, password_hash, role, home_dir, now],
        )?;

        let id = conn.last_insert_rowid();

        Ok(User {
            id,
            username: username.to_string(),
            role: role.to_string(),
            home_dir: home_dir.to_string(),
            is_pam: false,
        })
    }

    pub fn list_users(&self) -> Result<Vec<User>, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.db.lock().map_err(|_| "DB lock poisoned")?;
        let mut stmt = conn.prepare("SELECT id, username, role, home_dir FROM users ORDER BY username ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(User {
                id: row.get(0)?,
                username: row.get(1)?,
                role: row.get(2)?,
                home_dir: row.get(3)?,
                is_pam: false,
            })
        })?;

        let mut users = Vec::new();
        for user in rows {
            users.push(user?);
        }
        Ok(users)
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
            let mut stmt = conn.prepare("SELECT id, username, password_hash, role, home_dir FROM users WHERE username = ?1")?;
            let user_res = stmt.query_row(params![username], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            });

            if let Ok((id, uname, hash_str, role, home_dir)) = user_res {
                let parsed_hash = PasswordHash::new(&hash_str)
                    .map_err(|e| format!("Corrupt password hash: {}", e))?;
                if Argon2::default().verify_password(password.as_bytes(), &parsed_hash).is_ok() {
                    return Ok(User {
                        id,
                        username: uname,
                        role,
                        home_dir,
                        is_pam: false,
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
                        let (home_dir, role) = get_linux_user_info(username);
                        return Ok(User {
                            id: 0,
                            username: username.to_string(),
                            role,
                            home_dir,
                            is_pam: true,
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
