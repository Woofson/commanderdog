use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::time::Instant;
use tokio::process::Command;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionExecutionRequest {
    pub command: String,
    pub working_dir: String,
    pub selected_files: Vec<String>,
    pub target_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionExecutionResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u128,
    pub executed_command: String,
}

pub struct ActionRunner;

impl ActionRunner {
    pub async fn execute(req: ActionExecutionRequest) -> Result<ActionExecutionResult, String> {
        let first_file = req.selected_files.first().cloned().unwrap_or_default();
        let target_dir = req.target_dir.unwrap_or_default();
        let files_joined = req.selected_files.iter().map(|f| format!("\"{}\"", f)).collect::<Vec<_>>().join(" ");

        // Substitute variables: {file}, {dir}, {files}, {target_dir}
        let final_cmd = req.command
            .replace("{file}", &first_file)
            .replace("{dir}", &req.working_dir)
            .replace("{files}", &files_joined)
            .replace("{target_dir}", &target_dir);

        info!("Executing custom script action: {}", final_cmd);
        let start = Instant::now();

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let output_res = Command::new(&shell)
            .arg("-c")
            .arg(&final_cmd)
            .current_dir(&req.working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await;

        let duration_ms = start.elapsed().as_millis();

        match output_res {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let exit_code = output.status.code();

                Ok(ActionExecutionResult {
                    success: output.status.success(),
                    exit_code,
                    stdout,
                    stderr,
                    duration_ms,
                    executed_command: final_cmd,
                })
            }
            Err(e) => Err(format!("Failed to spawn command process: {}", e)),
        }
    }
}
