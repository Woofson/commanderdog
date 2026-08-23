fn main() {
    #[cfg(target_os = "linux")]
    {
        println!("cargo:rustc-link-lib=pam");
        println!("cargo:rustc-link-lib=pam_misc");

        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
        let target_libs = format!("{}/target/libs", manifest_dir);
        if std::path::Path::new(&target_libs).exists() {
            println!("cargo:rustc-link-search=native={}", target_libs);
        }
    }
}
