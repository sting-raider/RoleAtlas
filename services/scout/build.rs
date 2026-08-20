fn main() {
    // sqlx::migrate! embeds migrations at compile time. Make incremental local
    // builds notice newly added migration files instead of running a stale set.
    println!("cargo:rerun-if-changed=migrations");
}
