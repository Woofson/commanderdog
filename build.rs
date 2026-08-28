fn main() {
    #[cfg(all(target_os = "linux", feature = "pam"))]
    {
        // Common multiarch library directories across Debian, Ubuntu, Arch, Fedora, Alpine
        for dir in &[
            "/usr/lib/x86_64-linux-gnu",
            "/usr/lib/aarch64-linux-gnu",
            "/usr/lib64",
            "/usr/lib",
            "/lib/x86_64-linux-gnu",
            "/lib/aarch64-linux-gnu",
            "/lib64",
            "/lib",
        ] {
            if std::path::Path::new(dir).exists() {
                println!("cargo:rustc-link-search=native={}", dir);
            }
        }
    }
}
