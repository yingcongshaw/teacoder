use crate::crypto::keychain;
use crate::profile;
use crate::storage::AppDatabase;

#[tauri::command]
pub fn list_profiles(
    db: tauri::State<AppDatabase>,
    tool_type: Option<String>,
) -> Result<Vec<profile::Profile>, String> {
    profile::list_profiles(&db, tool_type.as_deref())
}

#[tauri::command]
pub fn create_profile(
    db: tauri::State<AppDatabase>,
    profile: profile::CreateProfileInput,
) -> Result<profile::Profile, String> {
    let result = profile::create_profile(&db, profile)?;

    // Store credentials in keychain if provided
    if let Some(ref api_key) = result.api_key_stored {
        if !api_key.is_empty() {
            keychain::store_secret(&result.id, "api_key", api_key)?;
        }
    }
    if let Some(ref token) = result.oauth_token_stored {
        if !token.is_empty() {
            keychain::store_secret(&result.id, "oauth_token", token)?;
        }
    }
    if let Some(ref token) = result.oauth_refresh_token_stored {
        if !token.is_empty() {
            keychain::store_secret(&result.id, "oauth_refresh_token", token)?;
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn update_profile(
    db: tauri::State<AppDatabase>,
    id: String,
    updates: serde_json::Value,
) -> Result<profile::Profile, String> {
    // Update credentials in keychain if provided
    if let Some(api_key) = updates.get("apiKey").and_then(|v| v.as_str()) {
        if !api_key.is_empty() {
            keychain::store_secret(&id, "api_key", api_key)?;
        } else {
            keychain::delete_secret(&id, "api_key")?;
        }
    }
    if let Some(token) = updates.get("oauthToken").and_then(|v| v.as_str()) {
        if !token.is_empty() {
            keychain::store_secret(&id, "oauth_token", token)?;
        } else {
            keychain::delete_secret(&id, "oauth_token")?;
        }
    }
    if let Some(token) = updates.get("oauthRefreshToken").and_then(|v| v.as_str()) {
        if !token.is_empty() {
            keychain::store_secret(&id, "oauth_refresh_token", token)?;
        } else {
            keychain::delete_secret(&id, "oauth_refresh_token")?;
        }
    }

    profile::update_profile(&db, &id, updates)
}

#[tauri::command]
pub fn delete_profile(
    db: tauri::State<AppDatabase>,
    id: String,
    options: Option<serde_json::Value>,
) -> Result<(), String> {
    let remove_data = options
        .as_ref()
        .and_then(|v| v.get("removeData"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // Always clean up keychain secrets when deleting a profile
    let _ = keychain::delete_all_secrets(&id);

    profile::delete_profile(&db, &id, remove_data)
}

/// Retrieve a masked (display-safe) version of a profile's API key.
#[tauri::command]
pub fn get_profile_credential(
    profile_id: String,
    key_name: String,
) -> Result<Option<String>, String> {
    let secret = keychain::get_secret(&profile_id, &key_name)?;
    Ok(secret.map(|s| keychain::mask_secret(&s)))
}

/// Store a credential for a profile in the system keychain.
#[tauri::command]
pub fn store_profile_credential(
    profile_id: String,
    key_name: String,
    value: String,
) -> Result<(), String> {
    keychain::store_secret(&profile_id, &key_name, &value)
}
