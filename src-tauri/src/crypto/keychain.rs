use keyring::Entry;

const SERVICE_NAME: &str = "com.teacoder.app";

/// Store a secret in the system keychain for a given profile and key name.
/// Key names: "api_key", "oauth_token", "oauth_refresh_token".
pub fn store_secret(profile_id: &str, key_name: &str, value: &str) -> Result<(), String> {
    let entry = entry_for(profile_id, key_name)?;
    entry
        .set_password(value)
        .map_err(|e| format!("Failed to store {} in keychain: {}", key_name, e))
}

/// Retrieve a secret from the system keychain.
/// Returns None if the secret does not exist.
pub fn get_secret(profile_id: &str, key_name: &str) -> Result<Option<String>, String> {
    let entry = entry_for(profile_id, key_name)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read {} from keychain: {}", key_name, e)),
    }
}

/// Delete a secret from the system keychain.
/// Returns Ok if the secret was deleted or did not exist.
pub fn delete_secret(profile_id: &str, key_name: &str) -> Result<(), String> {
    let entry = entry_for(profile_id, key_name)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete {} from keychain: {}", key_name, e)),
    }
}

/// Delete all stored secrets for a profile.
pub fn delete_all_secrets(profile_id: &str) -> Result<(), String> {
    for key_name in &["api_key", "oauth_token", "oauth_refresh_token"] {
        delete_secret(profile_id, key_name)?;
    }
    Ok(())
}

/// Mask a secret for display (e.g., "***...abc1").
pub fn mask_secret(value: &str) -> String {
    if value.len() < 8 {
        "***".to_string()
    } else {
        format!("***...{}", &value[value.len() - 4..])
    }
}

fn entry_for(profile_id: &str, key_name: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, &format!("profile:{}:{}", profile_id, key_name))
        .map_err(|e| format!("Failed to create keychain entry: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mask_secret_short() {
        assert_eq!(mask_secret("abc"), "***");
    }

    #[test]
    fn test_mask_secret_long() {
        assert_eq!(mask_secret("sk-ant-api03-longkey1234abc1"), "***...abc1");
    }

    #[test]
    fn test_mask_secret_exactly_8() {
        assert_eq!(mask_secret("12345678"), "***...5678");
    }
}
