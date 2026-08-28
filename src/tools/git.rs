use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitFileStatus {
    pub path: String,
    pub index_status: char,
    pub worktree_status: char,
    pub is_staged: bool,
    pub is_untracked: bool,
    pub is_modified: bool,
    pub is_deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatusResponse {
    pub is_repo: bool,
    pub root_path: Option<String>,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub is_clean: bool,
    pub staged_count: usize,
    pub unstaged_count: usize,
    pub untracked_count: usize,
    pub files: Vec<GitFileStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    pub author_email: String,
    pub date: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitDiffResponse {
    pub diff: String,
    pub file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitActionResponse {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

/// Query real-time git status for any directory
pub async fn get_git_status(path: &Path) -> GitStatusResponse {
    let check_repo = Command::new("git")
        .arg("rev-parse")
        .arg("--show-toplevel")
        .current_dir(path)
        .output()
        .await;

    let root_path = match check_repo {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        }
        _ => {
            return GitStatusResponse {
                is_repo: false,
                root_path: None,
                branch: String::new(),
                upstream: None,
                ahead: 0,
                behind: 0,
                is_clean: true,
                staged_count: 0,
                unstaged_count: 0,
                untracked_count: 0,
                files: Vec::new(),
            }
        }
    };

    // Get current branch name
    let branch_out = Command::new("git")
        .arg("branch")
        .arg("--show-current")
        .current_dir(path)
        .output()
        .await;

    let mut branch = match branch_out {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        }
        _ => "HEAD".to_string(),
    };

    if branch.is_empty() {
        // Fallback for detached HEAD
        let head_out = Command::new("git")
            .arg("rev-parse")
            .arg("--short")
            .arg("HEAD")
            .current_dir(path)
            .output()
            .await;
        if let Ok(out) = head_out {
            branch = format!("detached:{}", String::from_utf8_lossy(&out.stdout).trim());
        } else {
            branch = "main".to_string();
        }
    }

    // Ahead / behind upstream tracking
    let mut ahead = 0;
    let mut behind = 0;
    let mut upstream = None;

    let ab_out = Command::new("git")
        .arg("rev-list")
        .arg("--left-right")
        .arg("--count")
        .arg("@{u}...HEAD")
        .current_dir(path)
        .output()
        .await;

    if let Ok(out) = ab_out {
        if out.status.success() {
            let ab_str = String::from_utf8_lossy(&out.stdout);
            let parts: Vec<&str> = ab_str.trim().split_whitespace().collect();
            if parts.len() >= 2 {
                behind = parts[0].parse().unwrap_or(0);
                ahead = parts[1].parse().unwrap_or(0);
            }
        }
    }

    let up_out = Command::new("git")
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("@{u}")
        .current_dir(path)
        .output()
        .await;

    if let Ok(out) = up_out {
        if out.status.success() {
            upstream = Some(String::from_utf8_lossy(&out.stdout).trim().to_string());
        }
    }

    // Parse porcelain status
    let status_out = Command::new("git")
        .arg("status")
        .arg("--porcelain=v1")
        .arg("-uall")
        .current_dir(path)
        .output()
        .await;

    let mut files = Vec::new();
    let mut staged_count = 0;
    let mut unstaged_count = 0;
    let mut untracked_count = 0;

    if let Ok(out) = status_out {
        if out.status.success() {
            let raw = String::from_utf8_lossy(&out.stdout);
            for line in raw.lines() {
                if line.len() < 4 {
                    continue;
                }
                let idx_char = line.chars().next().unwrap_or(' ');
                let wt_char = line.chars().nth(1).unwrap_or(' ');
                let fpath = line[3..].trim().to_string();

                let is_untracked = idx_char == '?' && wt_char == '?';
                let is_staged = idx_char != ' ' && idx_char != '?';
                let is_modified = wt_char == 'M' || idx_char == 'M';
                let is_deleted = wt_char == 'D' || idx_char == 'D';

                if is_untracked {
                    untracked_count += 1;
                } else {
                    if is_staged {
                        staged_count += 1;
                    }
                    if wt_char != ' ' && wt_char != '?' {
                        unstaged_count += 1;
                    }
                }

                files.push(GitFileStatus {
                    path: fpath,
                    index_status: idx_char,
                    worktree_status: wt_char,
                    is_staged,
                    is_untracked,
                    is_modified,
                    is_deleted,
                });
            }
        }
    }

    let is_clean = files.is_empty();

    GitStatusResponse {
        is_repo: true,
        root_path: Some(root_path),
        branch,
        upstream,
        ahead,
        behind,
        is_clean,
        staged_count,
        unstaged_count,
        untracked_count,
        files,
    }
}

/// Get git diff for entire repository or a specific file
pub async fn get_git_diff(path: &Path, file_path: Option<&str>, staged: bool) -> GitDiffResponse {
    let mut cmd = Command::new("git");
    cmd.arg("diff");
    if staged {
        cmd.arg("--cached");
    }
    if let Some(f) = file_path {
        cmd.arg("--").arg(f);
    }
    cmd.current_dir(path);

    match cmd.output().await {
        Ok(out) => GitDiffResponse {
            diff: String::from_utf8_lossy(&out.stdout).to_string(),
            file: file_path.map(|s| s.to_string()),
        },
        Err(e) => GitDiffResponse {
            diff: format!("Error running git diff: {}", e),
            file: file_path.map(|s| s.to_string()),
        },
    }
}

/// Stage files (`git add ...`)
pub async fn git_stage(path: &Path, files: &[String]) -> GitActionResponse {
    let mut cmd = Command::new("git");
    cmd.arg("add");
    if files.is_empty() || (files.len() == 1 && files[0] == ".") {
        cmd.arg("-A");
    } else {
        for f in files {
            cmd.arg(f);
        }
    }
    cmd.current_dir(path);

    match cmd.output().await {
        Ok(out) if out.status.success() => GitActionResponse {
            success: true,
            output: String::from_utf8_lossy(&out.stdout).to_string(),
            error: None,
        },
        Ok(out) => GitActionResponse {
            success: false,
            output: String::from_utf8_lossy(&out.stdout).to_string(),
            error: Some(String::from_utf8_lossy(&out.stderr).to_string()),
        },
        Err(e) => GitActionResponse {
            success: false,
            output: String::new(),
            error: Some(e.to_string()),
        },
    }
}

/// Unstage files (`git reset HEAD ...`)
pub async fn git_unstage(path: &Path, files: &[String]) -> GitActionResponse {
    let mut cmd = Command::new("git");
    cmd.arg("restore").arg("--staged");
    if files.is_empty() || (files.len() == 1 && files[0] == ".") {
        cmd.arg(".");
    } else {
        for f in files {
            cmd.arg(f);
        }
    }
    cmd.current_dir(path);

    match cmd.output().await {
        Ok(out) if out.status.success() => GitActionResponse {
            success: true,
            output: String::from_utf8_lossy(&out.stdout).to_string(),
            error: None,
        },
        Ok(out) => GitActionResponse {
            success: false,
            output: String::from_utf8_lossy(&out.stdout).to_string(),
            error: Some(String::from_utf8_lossy(&out.stderr).to_string()),
        },
        Err(e) => GitActionResponse {
            success: false,
            output: String::new(),
            error: Some(e.to_string()),
        },
    }
}

/// Commit staged changes
pub async fn git_commit(path: &Path, message: &str) -> GitActionResponse {
    let mut cmd = Command::new("git");
    cmd.arg("commit").arg("-m").arg(message).current_dir(path);

    match cmd.output().await {
        Ok(out) if out.status.success() => GitActionResponse {
            success: true,
            output: String::from_utf8_lossy(&out.stdout).to_string(),
            error: None,
        },
        Ok(out) => GitActionResponse {
            success: false,
            output: String::from_utf8_lossy(&out.stdout).to_string(),
            error: Some(String::from_utf8_lossy(&out.stderr).to_string()),
        },
        Err(e) => GitActionResponse {
            success: false,
            output: String::new(),
            error: Some(e.to_string()),
        },
    }
}

/// Push commits to remote
pub async fn git_push(path: &Path, remote: Option<&str>, branch: Option<&str>) -> GitActionResponse {
    let mut cmd = Command::new("git");
    cmd.arg("push");
    if let Some(r) = remote {
        cmd.arg(r);
    }
    if let Some(b) = branch {
        cmd.arg(b);
    }
    cmd.current_dir(path);

    match cmd.output().await {
        Ok(out) if out.status.success() => GitActionResponse {
            success: true,
            output: String::from_utf8_lossy(&out.stdout).to_string(),
            error: None,
        },
        Ok(out) => GitActionResponse {
            success: false,
            output: String::from_utf8_lossy(&out.stdout).to_string(),
            error: Some(String::from_utf8_lossy(&out.stderr).to_string()),
        },
        Err(e) => GitActionResponse {
            success: false,
            output: String::new(),
            error: Some(e.to_string()),
        },
    }
}

/// Pull commits from remote
pub async fn git_pull(path: &Path) -> GitActionResponse {
    let mut cmd = Command::new("git");
    cmd.arg("pull").current_dir(path);

    match cmd.output().await {
        Ok(out) if out.status.success() => GitActionResponse {
            success: true,
            output: String::from_utf8_lossy(&out.stdout).to_string(),
            error: None,
        },
        Ok(out) => GitActionResponse {
            success: false,
            output: String::from_utf8_lossy(&out.stdout).to_string(),
            error: Some(String::from_utf8_lossy(&out.stderr).to_string()),
        },
        Err(e) => GitActionResponse {
            success: false,
            output: String::new(),
            error: Some(e.to_string()),
        },
    }
}

/// Get git commit history log
pub async fn get_git_log(path: &Path, max_count: usize) -> Vec<GitCommitInfo> {
    let mut cmd = Command::new("git");
    cmd.arg("log")
        .arg(format!("-n{}", max_count.max(1).min(100)))
        .arg("--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s%x1e")
        .arg("--date=relative")
        .current_dir(path);

    let mut commits = Vec::new();
    if let Ok(out) = cmd.output().await {
        if out.status.success() {
            let raw = String::from_utf8_lossy(&out.stdout);
            for record in raw.split('\x1e') {
                let rec = record.trim();
                if rec.is_empty() {
                    continue;
                }
                let fields: Vec<&str> = rec.split('\x1f').collect();
                if fields.len() >= 6 {
                    commits.push(GitCommitInfo {
                        hash: fields[0].to_string(),
                        short_hash: fields[1].to_string(),
                        author_name: fields[2].to_string(),
                        author_email: fields[3].to_string(),
                        date: fields[4].to_string(),
                        message: fields[5].to_string(),
                    });
                }
            }
        }
    }
    commits
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use tokio::fs;

    #[tokio::test]
    async fn test_git_status_and_actions() {
        let temp_dir = tempdir().unwrap();
        let repo_path = temp_dir.path();

        // Initialize git repo in temp dir
        let init_out = std::process::Command::new("git")
            .arg("init")
            .arg("-b")
            .arg("main")
            .current_dir(repo_path)
            .output();
        if init_out.is_err() || !init_out.unwrap().status.success() {
            // If git not installed or old git version, skip test gracefully
            return;
        }

        // Configure dummy user for committing
        let _ = std::process::Command::new("git").args(["config", "user.name", "Tester"]).current_dir(repo_path).output();
        let _ = std::process::Command::new("git").args(["config", "user.email", "test@example.com"]).current_dir(repo_path).output();

        // Check clean status
        let status = get_git_status(repo_path).await;
        assert!(status.is_repo);
        assert!(status.is_clean);

        // Create new file
        let test_file = repo_path.join("hello.txt");
        fs::write(&test_file, "Hello World\n").await.unwrap();

        // Check untracked file detected
        let status2 = get_git_status(repo_path).await;
        assert!(!status2.is_clean);
        assert_eq!(status2.untracked_count, 1);

        // Stage file
        let stage_res = git_stage(repo_path, &["hello.txt".to_string()]).await;
        assert!(stage_res.success);

        // Verify staged status
        let status3 = get_git_status(repo_path).await;
        assert_eq!(status3.staged_count, 1);

        // Commit
        let commit_res = git_commit(repo_path, "feat: initial commit").await;
        assert!(commit_res.success);

        // Verify clean again
        let status4 = get_git_status(repo_path).await;
        assert!(status4.is_clean);

        // Check git log
        let log = get_git_log(repo_path, 10).await;
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].message, "feat: initial commit");
    }
}
