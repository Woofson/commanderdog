#!/usr/bin/env python3
"""
CommanderDog Automated Factory Acceptance Test (FAT) & Simulation Suite
Tests all core APIs, SQLite persistence, directory flattening, tagging, and search.
"""

import os
import sys
import time
import shutil
import tempfile
import subprocess
import requests
import json

PORT = 8999
BASE_URL = f"http://127.0.0.1:{PORT}"
TEST_DIR = tempfile.mkdtemp(prefix="cd_fat_test_")
DB_PATH = os.path.join(TEST_DIR, "fat_test.db")
SERVER_PROC = None

# Colors
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

results = {"passed": 0, "failed": 0, "total": 0}

def log_test(test_id, name, passed, detail=""):
    results["total"] += 1
    if passed:
        results["passed"] += 1
        print(f"  {GREEN}✔ [{test_id}]{RESET} {name} {detail}")
    else:
        results["failed"] += 1
        print(f"  {RED}✖ [{test_id}]{RESET} {BOLD}{name}{RESET} - {RED}{detail}{RESET}")

def start_test_server():
    global SERVER_PROC
    print(f"\n{CYAN}🚀 Starting isolated test instance on port {PORT}...{RESET}")
    
    # Create isolated conf.d
    conf_dir = os.path.join(TEST_DIR, "conf.d")
    os.makedirs(conf_dir, exist_ok=True)
    with open(os.path.join(conf_dir, "00-server.toml"), "w") as f:
        f.write(f"""
[server]
host = "127.0.0.1"
port = {PORT}
database_path = "{DB_PATH}"

[auth]
default_admin_user = "admin"
default_admin_pass = "admin123"
""")
    
    release_bin = os.path.abspath("./target/release/commanderdog")
    debug_bin = os.path.abspath("./target/debug/commanderdog")
    bin_path = debug_bin
    if os.path.exists(release_bin) and (not os.path.exists(debug_bin) or os.path.getmtime(release_bin) >= os.path.getmtime(debug_bin)):
        bin_path = release_bin
    
    # Symlink frontend assets into TEST_DIR so static assets serve cleanly
    os.symlink(os.path.abspath("./frontend"), os.path.join(TEST_DIR, "frontend"))
    
    SERVER_PROC = subprocess.Popen(
        [bin_path],
        cwd=TEST_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    
    for _ in range(30):
        try:
            r = requests.get(f"{BASE_URL}/", timeout=1)
            if r.status_code == 200:
                print(f"{GREEN}✔ Isolated test server is online at {BASE_URL}{RESET}\n")
                return True
        except Exception:
            time.sleep(0.3)
    
    print(f"{RED}Failed to connect to server!{RESET}")
    return False

def stop_test_server():
    global SERVER_PROC
    if SERVER_PROC:
        print(f"\n{CYAN}🛑 Stopping test server...{RESET}")
        SERVER_PROC.terminate()
        try:
            SERVER_PROC.wait(timeout=3)
        except Exception:
            SERVER_PROC.kill()
    if os.path.exists(TEST_DIR):
        shutil.rmtree(TEST_DIR, ignore_errors=True)

def run_tests():
    # -------------------------------------------------------------
    # SUITE 1: Auth & User Management
    # -------------------------------------------------------------
    print(f"{BOLD}=== 🔐 SUITE 1: Auth & Security ==={RESET}")
    
    # 1. Login
    login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "admin", "password": "admin123"})
    token = ""
    if login_resp.status_code == 200:
        token = login_resp.json().get("token", "")
        log_test("AUTH-01", "Admin Login & JWT Issuance", bool(token), f"Token length: {len(token)}")
    else:
        log_test("AUTH-01", "Admin Login & JWT Issuance", False, f"HTTP {login_resp.status_code}")
        return

    headers = {"Authorization": f"Bearer {token}"}

    # 2. Get Profile
    me_resp = requests.get(f"{BASE_URL}/api/auth/me", headers=headers)
    log_test("AUTH-02", "Get Current User Profile (/api/auth/me)", me_resp.status_code == 200 and me_resp.json().get("username") == "admin")

    # -------------------------------------------------------------
    # SUITE 2: Directory & Flat / Branch View
    # -------------------------------------------------------------
    print(f"\n{BOLD}=== 🌲 SUITE 2: Directory & Flat / Branch View ==={RESET}")
    
    # Setup test folder structure:
    # TEST_DIR/
    #   folderA/fileA1.txt
    #   folderA/subA/fileA2.rs
    #   folderB/fileB1.jpg
    #   root_file.txt
    data_dir = os.path.join(TEST_DIR, "data")
    folder_a = os.path.join(data_dir, "folderA")
    sub_a = os.path.join(folder_a, "subA")
    folder_b = os.path.join(data_dir, "folderB")
    os.makedirs(sub_a, exist_ok=True)
    os.makedirs(folder_b, exist_ok=True)
    
    with open(os.path.join(folder_a, "fileA1.txt"), "w") as f: f.write("Hello from A1\nTarget content line here\n")
    with open(os.path.join(sub_a, "fileA2.rs"), "w") as f: f.write("fn main() { println!(\"Target content in rust\"); }\n")
    with open(os.path.join(folder_b, "fileB1.jpg"), "w") as f: f.write("fake-image-bytes-1234567890")
    with open(os.path.join(data_dir, "root_file.txt"), "w") as f: f.write("Top level file")

    # Standard Directory List
    list_resp = requests.get(f"{BASE_URL}/api/fs/list?path={data_dir}&show_hidden=true", headers=headers)
    if list_resp.status_code == 200:
        data = list_resp.json()
        names = [e["name"] for e in data.get("entries", [])]
        log_test("DIR-01", "Standard Directory Listing", "folderA" in names and "folderB" in names and "root_file.txt" in names, f"Found {len(names)} entries")
    else:
        log_test("DIR-01", "Standard Directory Listing", False, f"HTTP {list_resp.status_code}")

    # Flat / Branch View (flat=true)
    flat_resp = requests.get(f"{BASE_URL}/api/fs/list?path={data_dir}&show_hidden=true&flat=true", headers=headers)
    if flat_resp.status_code == 200:
        flat_data = flat_resp.json()
        entries = flat_data.get("entries", [])
        entry_paths = [e["name"] for e in entries]
        has_nested = any("subA/fileA2.rs" in p for p in entry_paths)
        log_test("DIR-02", "Flat / Branch View (<kbd>Ctrl+B</kbd>)", has_nested and len(entries) >= 4, f"Flattened {len(entries)} items across subdirectories")
    else:
        log_test("DIR-02", "Flat / Branch View", False, f"HTTP {flat_resp.status_code}")

    # -------------------------------------------------------------
    # SUITE 3: Color Labels & Custom Tagging System
    # -------------------------------------------------------------
    print(f"\n{BOLD}=== 🏷️ SUITE 3: Color Labels & Tagging Engine ==={RESET}")
    
    target_file = os.path.join(sub_a, "fileA2.rs")
    
    # 1. Set Color Label & Custom Tags
    tag_set_resp = requests.post(f"{BASE_URL}/api/fs/tags/set", headers=headers, json={
        "paths": [target_file],
        "color_label": "red",
        "set_tags": ["urgent", "rust-code", "v2"]
    })
    log_test("TAG-01", "Set Color Label (Red) & Custom Tags", tag_set_resp.status_code == 200)

    # 2. Get Tags For Specific Path
    tag_get_resp = requests.get(f"{BASE_URL}/api/fs/tags?path={target_file}", headers=headers)
    if tag_get_resp.status_code == 200:
        res_json = tag_get_resp.json()
        tag_info = res_json.get("tag") or res_json
        is_red = tag_info.get("color_label") == "red"
        tags = tag_info.get("tags", [])
        log_test("TAG-02", "Fetch File Tags & Color", is_red and "urgent" in tags and "v2" in tags, f"Tags: {tags}, Color: {tag_info.get('color_label')}")
    else:
        log_test("TAG-02", "Fetch File Tags", False, f"HTTP {tag_get_resp.status_code}")

    # 3. Get All Tags (App Initialization)
    all_tags_resp = requests.get(f"{BASE_URL}/api/fs/tags/all", headers=headers)
    if all_tags_resp.status_code == 200:
        all_tags = all_tags_resp.json().get("tags", [])
        log_test("TAG-03", "Fetch All File Tags (/api/fs/tags/all)", len(all_tags) >= 1)
    else:
        log_test("TAG-03", "Fetch All File Tags", False)

    # -------------------------------------------------------------
    # SUITE 4: Deep Search & Regex Grep
    # -------------------------------------------------------------
    print(f"\n{BOLD}=== 🔍 SUITE 4: Deep Search & Live Grep ==={RESET}")
    
    # 1. Name Pattern Search
    search_name_resp = requests.post(f"{BASE_URL}/api/tools/search", headers=headers, json={
        "path": data_dir,
        "name_pattern": "*.rs"
    })
    if search_name_resp.status_code == 200:
        items = search_name_resp.json()
        log_test("SRC-01", "Name Glob Search (*.rs)", len(items) >= 1 and any("fileA2.rs" in i["path"] for i in items))
    else:
        log_test("SRC-01", "Name Glob Search", False)

    # 2. Content Regex Grep
    search_grep_resp = requests.post(f"{BASE_URL}/api/tools/search", headers=headers, json={
        "path": data_dir,
        "content_query": "Target content"
    })
    if search_grep_resp.status_code == 200:
        grep_items = search_grep_resp.json()
        has_matches = len(grep_items) >= 2 and any(len(i.get("matched_lines", [])) > 0 for i in grep_items)
        log_test("SRC-02", "Content Regex Grep with Match Snippets", has_matches, f"Found {len(grep_items)} matching files")
    else:
        log_test("SRC-02", "Content Regex Grep", False)

    # -------------------------------------------------------------
    # SUITE 5: Disk Space Treemap & Analyzer
    # -------------------------------------------------------------
    print(f"\n{BOLD}=== 📊 SUITE 5: Disk Usage & Space Analyzer ==={RESET}")
    
    du_resp = requests.get(f"{BASE_URL}/api/tools/disk-usage?path={data_dir}", headers=headers)
    if du_resp.status_code == 200:
        du_data = du_resp.json()
        total_size = du_data.get("total_bytes", 0)
        items = du_data.get("items", [])
        log_test("DU-01", "Recursive Space Aggregation (/api/tools/disk-usage)", total_size > 0 and len(items) > 0, f"Total calculated size: {total_size} bytes, {len(items)} child entries")
    else:
        log_test("DU-01", "Space Aggregation", False, f"HTTP {du_resp.status_code}")

    # -------------------------------------------------------------
    # SUITE 6: Two-Way Directory Synchronizer
    # -------------------------------------------------------------
    print(f"\n{BOLD}=== 🔀 SUITE 6: Two-Way Directory Synchronizer ==={RESET}")
    
    dir_sync_a = os.path.join(TEST_DIR, "syncA")
    dir_sync_b = os.path.join(TEST_DIR, "syncB")
    os.makedirs(dir_sync_a, exist_ok=True)
    os.makedirs(dir_sync_b, exist_ok=True)
    with open(os.path.join(dir_sync_a, "left_only.txt"), "w") as f: f.write("Left data")
    with open(os.path.join(dir_sync_b, "right_only.txt"), "w") as f: f.write("Right data")
    with open(os.path.join(dir_sync_a, "both.txt"), "w") as f: f.write("Identical data")
    with open(os.path.join(dir_sync_b, "both.txt"), "w") as f: f.write("Identical data")

    compare_resp = requests.post(f"{BASE_URL}/api/tools/sync/analyze", headers=headers, json={
        "source": dir_sync_a,
        "destination": dir_sync_b,
        "options": {
            "mode": "bidirectional_newer",
            "dry_run": True,
            "verify_checksum": False,
            "delete_orphans": False
        }
    })
    if compare_resp.status_code == 200:
        sync_data = compare_resp.json()
        files = sync_data.get("files", [])
        log_test("SYNC-01", "Directory Comparison & Difference Detection", len(files) >= 3, f"Analyzed {len(files)} files (Identical: {sync_data.get('identical_count')}, Left only: {sync_data.get('left_only_count')}, Right only: {sync_data.get('right_only_count')})")
    else:
        log_test("SYNC-01", "Directory Comparison", False, f"HTTP {compare_resp.status_code}")

    # -------------------------------------------------------------
    # SUITE 7: File Operations, Bulk Renamer & Deletion
    # -------------------------------------------------------------
    print(f"\n{BOLD}=== 🗄️ SUITE 7: File Operations & Batch Renamer ==={RESET}")
    
    # 1. Create Directory
    mkdir_target = os.path.join(data_dir, "test_mkdir_tree", "sub_level")
    mkdir_resp = requests.post(f"{BASE_URL}/api/fs/mkdir", headers=headers, json={"path": mkdir_target})
    log_test("FOP-01", "Recursive Mkdir (/api/fs/mkdir)", mkdir_resp.status_code == 200 and os.path.exists(mkdir_target))

    # 2. Write New File
    write_target = os.path.join(mkdir_target, "test_note.txt")
    write_resp = requests.post(f"{BASE_URL}/api/fs/write", headers=headers, json={"path": write_target, "content": "Sample content for testing"})
    log_test("FOP-02", "Write Text File (/api/fs/write)", write_resp.status_code == 200 and os.path.exists(write_target))

    # 3. Read File Content
    read_resp = requests.get(f"{BASE_URL}/api/fs/read?path={write_target}", headers=headers)
    log_test("FOP-03", "Read Text File (/api/fs/read)", read_resp.status_code == 200 and "Sample content" in read_resp.text)

    # 4. Rename File
    renamed_target = os.path.join(mkdir_target, "test_note_renamed.txt")
    rename_resp = requests.post(f"{BASE_URL}/api/fs/rename", headers=headers, json={"from": write_target, "to": renamed_target})
    log_test("FOP-04", "Rename Single File (/api/fs/rename)", rename_resp.status_code == 200 and os.path.exists(renamed_target))

    # 5. Bulk Batch Rename
    batch_renamed_dest = os.path.join(mkdir_target, "batch_renamed_001.txt")
    batch_resp = requests.post(f"{BASE_URL}/api/fs/batch-rename", headers=headers, json={
        "renames": [{"from": renamed_target, "to": batch_renamed_dest}]
    })
    log_test("FOP-05", "Bulk Batch Rename (/api/fs/batch-rename)", batch_resp.status_code == 200 and os.path.exists(batch_renamed_dest))

    # 6. Delete File
    del_resp = requests.post(f"{BASE_URL}/api/fs/delete", headers=headers, json={"paths": [batch_renamed_dest], "use_trash": False})
    log_test("FOP-06", "Delete Files (/api/fs/delete)", del_resp.status_code == 200 and not os.path.exists(batch_renamed_dest))

    # -------------------------------------------------------------
    # SUITE 8: Unix Permissions Matrix & Chmod
    # -------------------------------------------------------------
    print(f"\n{BOLD}=== 🔒 SUITE 8: Unix Permissions & Chmod ==={RESET}")
    
    chmod_target = os.path.join(data_dir, "root_file.txt")
    chmod_resp = requests.post(f"{BASE_URL}/api/fs/chmod", headers=headers, json={"paths": [chmod_target], "mode": 0o755, "recursive": False})
    log_test("SEC-01", "Update POSIX Permissions (/api/fs/chmod 0755)", chmod_resp.status_code == 200)

    # -------------------------------------------------------------
    # SUITE 9: Public Share Links & Bookmarks
    # -------------------------------------------------------------
    print(f"\n{BOLD}=== 🔗 SUITE 9: Public Share Links & Bookmarks ==={RESET}")
    
    # 1. Create Share
    share_resp = requests.post(f"{BASE_URL}/api/shares", headers=headers, json={
        "path": chmod_target,
        "is_dir": False,
        "allow_upload": False,
        "max_downloads": 5
    })
    token_val = ""
    if share_resp.status_code == 200:
        token_val = share_resp.json().get("token", "")
        log_test("SHARE-01", "Generate Public Share Link (/api/shares)", bool(token_val), f"Token: {token_val}")
    else:
        log_test("SHARE-01", "Generate Public Share Link", False)

    # 2. Public Get Share Metadata
    if token_val:
        pub_resp = requests.get(f"{BASE_URL}/api/public/shares/{token_val}/meta")
        log_test("SHARE-02", "Public Guest Share Metadata (/api/public/shares/:token/meta)", pub_resp.status_code == 200)

    # 3. Create & List Bookmarks
    bmark_resp = requests.post(f"{BASE_URL}/api/bookmarks", headers=headers, json={"name": "Test Quick Bookmark", "protocol": "local", "path": data_dir})
    log_test("BMARK-01", "Create Bookmark (/api/bookmarks)", bmark_resp.status_code == 200)
    list_bmark = requests.get(f"{BASE_URL}/api/bookmarks", headers=headers)
    log_test("BMARK-02", "List Bookmarks (/api/bookmarks)", list_bmark.status_code == 200 and len(list_bmark.json()) >= 1)

    # -------------------------------------------------------------
    # SUITE 10: Frontend Asset Integrity & JS Validation
    # -------------------------------------------------------------
    print(f"\n{BOLD}=== 🌐 SUITE 10: Frontend Assets & Syntax Integrity ==={RESET}")
    
    # 1. HTML Assets
    html_resp = requests.get(f"{BASE_URL}/")
    has_calculator = "floating-calculator-window" in html_resp.text
    has_branch = "toggleBranchView" in html_resp.text or "Flat / Branch View" in html_resp.text
    has_git_modal = "git-modal" in html_resp.text
    has_split_modal = "file-splitter-modal" in html_resp.text
    log_test("WEB-01", "Frontend HTML & Component Integrity", html_resp.status_code == 200 and has_calculator and has_branch and has_git_modal and has_split_modal)

    # 2. JavaScript Syntax Validation via gjs / node / quickjs
    gjs_cmd = subprocess.run(["gjs", "-c", """
    const GLib = imports.gi.GLib;
    const [ok, contents] = GLib.file_get_contents('frontend/app.js');
    new Function(imports.byteArray.toString(contents));
    """], capture_output=True)
    log_test("WEB-02", "ES6 JavaScript Parser & Syntax Validation", gjs_cmd.returncode == 0)

    # -------------------------------------------------------------
    # SUITE 11: Git Version Control Engine & APIs
    # -------------------------------------------------------------
    print(f"\n{BOLD}=== 🌲 SUITE 11: Git Engine & Version Control APIs ==={RESET}")

    # 1. Git Status for non-repo
    non_repo_resp = requests.get(f"{BASE_URL}/api/git/status", params={"path": data_dir}, headers=headers)
    log_test("GIT-01", "Git Status on Directory (/api/git/status)", non_repo_resp.status_code == 200)

    # 2. Create isolated git repo and test status / stage / commit
    git_test_repo = os.path.join(TEST_DIR, "git_sandbox_repo")
    os.makedirs(git_test_repo, exist_ok=True)
    subprocess.run(["git", "init", "-b", "main"], cwd=git_test_repo, capture_output=True)
    subprocess.run(["git", "config", "user.name", "FAT Tester"], cwd=git_test_repo, capture_output=True)
    subprocess.run(["git", "config", "user.email", "tester@commanderdog.com"], cwd=git_test_repo, capture_output=True)

    with open(os.path.join(git_test_repo, "demo.txt"), "w") as f:
        f.write("Hello Git World\n")

    git_stat = requests.get(f"{BASE_URL}/api/git/status", params={"path": git_test_repo}, headers=headers)
    log_test("GIT-02", "Git Untracked File Detection", git_stat.status_code == 200 and git_stat.json().get("untracked_count", 0) >= 1)

    stage_resp = requests.post(f"{BASE_URL}/api/git/stage", headers=headers, json={"path": git_test_repo, "files": ["demo.txt"]})
    log_test("GIT-03", "Git Stage File (/api/git/stage)", stage_resp.status_code == 200 and stage_resp.json().get("success") is True)

    commit_resp = requests.post(f"{BASE_URL}/api/git/commit", headers=headers, json={"path": git_test_repo, "message": "feat: test automated commit"})
    log_test("GIT-04", "Git Commit Staged (/api/git/commit)", commit_resp.status_code == 200 and commit_resp.json().get("success") is True)

    log_resp = requests.get(f"{BASE_URL}/api/git/log", params={"path": git_test_repo, "count": 10}, headers=headers)
    log_test("GIT-05", "Git Commit Log (/api/git/log)", log_resp.status_code == 200 and len(log_resp.json()) >= 1)

    # -------------------------------------------------------------
    # SUITE 12: Multi-Part File Splitter & Combiner
    # -------------------------------------------------------------
    print(f"\n{BOLD}=== 🧩 SUITE 12: Multi-Part File Splitter & Combiner ==={RESET}")

    # 1. Create 3MB binary test file
    split_src_file = os.path.join(TEST_DIR, "large_sample.dat")
    with open(split_src_file, "wb") as f:
        f.write(os.urandom(3 * 1024 * 1024)) # 3MB

    split_resp = requests.post(f"{BASE_URL}/api/tools/split", headers=headers, json={
        "source_path": split_src_file,
        "chunk_size_mb": 1,
        "generate_checksum": True
    })
    log_test("SPLIT-01", "Split File into 1MB Chunks (/api/tools/split)", split_resp.status_code == 200 and split_resp.json().get("chunk_count") == 3)

    if split_resp.status_code == 200:
        split_data = split_resp.json()
        parts = split_data.get("parts", [])
        expected_sha = split_data.get("sha256", "")

        combine_dest = os.path.join(TEST_DIR, "recombined_sample.dat")
        combine_resp = requests.post(f"{BASE_URL}/api/tools/combine", headers=headers, json={
            "parts": parts,
            "dest_path": combine_dest,
            "expected_sha256": expected_sha
        })
        log_test("SPLIT-02", "Combine Parts & Verify Checksum (/api/tools/combine)", combine_resp.status_code == 200 and combine_resp.json().get("is_verified") is True)

    # Summary
    print(f"\n{BOLD}======================================================{RESET}")
    print(f"{BOLD}📊 AUTOMATED TEST SUMMARY:{RESET}")
    print(f"  Total Tests Executed: {results['total']}")
    print(f"  Passed: {GREEN}{results['passed']}{RESET}")
    print(f"  Failed: {RED if results['failed'] > 0 else GREEN}{results['failed']}{RESET}")
    print(f"{BOLD}======================================================{RESET}\n")

if __name__ == "__main__":
    try:
        if start_test_server():
            run_tests()
    finally:
        stop_test_server()
