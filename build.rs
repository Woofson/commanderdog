fn main() {
    #[cfg(target_os = "linux")]
    {
        // Common multiarch library directories across Debian, Ubuntu, Arch, Fedora, Alpine
        let search_dirs = [
            "/usr/lib/x86_64-linux-gnu",
            "/usr/lib/aarch64-linux-gnu",
            "/usr/lib64",
            "/usr/lib",
            "/lib/x86_64-linux-gnu",
            "/lib/aarch64-linux-gnu",
            "/lib64",
            "/lib",
        ];

        for dir in &search_dirs {
            let dir_path = std::path::Path::new(dir);
            if dir_path.exists() {
                println!("cargo:rustc-link-search=native={}", dir);
            }
        }

        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
        let target_libs = std::path::PathBuf::from(&manifest_dir).join("target").join("libs");
        let _ = std::fs::create_dir_all(&target_libs);

        for lib_base in &["libpam", "libpam_misc", "libpamc"] {
            let target_so = target_libs.join(format!("{}.so", lib_base));
            let _ = std::fs::remove_file(&target_so);
            for dir in &search_dirs {
                let dir_path = std::path::Path::new(dir);
                if !dir_path.exists() {
                    continue;
                }
                for suffix in &[".so", ".so.0", ".so.0.85.1", ".so.0.82.1"] {
                    let src = dir_path.join(format!("{}{}", lib_base, suffix));
                    if src.exists() {
                        #[cfg(unix)]
                        let _ = std::os::unix::fs::symlink(&src, &target_so);
                        break;
                    }
                }
                if target_so.exists() {
                    break;
                }
            }
        }

        println!("cargo:rustc-link-search=native={}", target_libs.display());
    }
}
