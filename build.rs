fn main() {
    #[cfg(windows)]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("assets/commanderdog.ico");
        res.set("ProductName", "CommanderDog");
        res.set("FileDescription", "Multi-Tab Web Commander - By Woofson");
        res.set("LegalCopyright", "Copyright (c) 2026 Bolt J Woofson");
        let _ = res.compile();
    }
}
