//! macOS Keychain storage for the optional JIRA API token. The token never
//! touches SQLite; only the non-secret site/email live in app settings. Keyed
//! per-site so a future multi-site mode can coexist.

use keyring::Entry;

/// The app bundle identifier (see `native/tauri.conf.json`), used as the
/// Keychain service name.
const SERVICE: &str = "com.hvp17.nectus";

fn entry(site: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, &format!("jira-api-token:{site}"))
        .map_err(|error| format!("Failed to open Keychain entry: {error}"))
}

pub fn store_token(site: &str, token: &str) -> Result<(), String> {
    entry(site)?
        .set_password(token)
        .map_err(|error| format!("Failed to store JIRA token: {error}"))
}

/// Read the token for a site, or `None` if no entry exists.
pub fn read_token(site: &str) -> Result<Option<String>, String> {
    match entry(site)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read JIRA token: {error}")),
    }
}

pub fn delete_token(site: &str) -> Result<(), String> {
    match entry(site)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Failed to delete JIRA token: {error}")),
    }
}
