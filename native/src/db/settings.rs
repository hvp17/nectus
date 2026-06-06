use super::rows::app_settings_from_row;
use super::{now, Database};
use crate::models::{AppSettings, AppSettingsInput};
use rusqlite::{params, OptionalExtension};

impl Database {
    pub fn get_app_settings(&self) -> Result<AppSettings, String> {
        self.conn
            .query_row(
                "
                SELECT default_agent_profile_id, default_worktree_root_pattern, default_branch_prefix, theme, density, updated_at, jira_board_jql, jira_site_url, jira_board_project, jira_filter_my_issues, jira_filter_unresolved, jira_filter_current_sprint, jira_rest_email, jira_filter_statuses
                FROM app_settings
                WHERE id = 1
                ",
                [],
                app_settings_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "App settings were not initialized".to_string())
    }

    pub fn update_app_settings(&self, settings: AppSettingsInput) -> Result<AppSettings, String> {
        if settings.default_worktree_root_pattern.trim().is_empty() {
            return Err("Worktree root pattern is required".into());
        }
        if !settings.default_worktree_root_pattern.contains("{repoName}") {
            return Err("Worktree root pattern must include {repoName}".into());
        }
        if let Some(profile_id) = settings.default_agent_profile_id {
            self.agent_profile_by_id(profile_id)?
                .ok_or_else(|| "Default agent profile not found".to_string())?;
        }

        let default_branch_prefix = settings
            .default_branch_prefix
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let jira_board_jql = settings
            .jira_board_jql
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let jira_site_url = settings
            .jira_site_url
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let jira_board_project = settings
            .jira_board_project
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let jira_filter_statuses = serde_json::to_string(&settings.jira_filter_statuses)
            .unwrap_or_else(|_| "[]".to_string());
        let pattern = settings.default_worktree_root_pattern.trim().to_string();
        let updated_at = now();
        self.conn
            .execute(
                "
                UPDATE app_settings
                SET default_agent_profile_id = ?1,
                    default_worktree_root_pattern = ?2,
                    default_branch_prefix = ?3,
                    theme = ?4,
                    density = ?5,
                    updated_at = ?6,
                    jira_board_jql = ?7,
                    jira_site_url = ?8,
                    jira_board_project = ?9,
                    jira_filter_my_issues = ?10,
                    jira_filter_unresolved = ?11,
                    jira_filter_current_sprint = ?12,
                    jira_filter_statuses = ?13
                WHERE id = 1
                ",
                params![
                    settings.default_agent_profile_id,
                    pattern,
                    default_branch_prefix,
                    settings.theme.as_str(),
                    settings.density.as_str(),
                    updated_at,
                    jira_board_jql,
                    jira_site_url,
                    jira_board_project,
                    settings.jira_filter_my_issues,
                    settings.jira_filter_unresolved,
                    settings.jira_filter_current_sprint,
                    jira_filter_statuses
                ],
            )
            .map_err(|error| format!("Failed to update app settings: {error}"))?;
        self.refresh_repo_worktree_roots(&pattern)?;
        self.get_app_settings()
    }

    /// Persist the non-secret REST account (site + email). The token itself lives
    /// only in the Keychain; this never writes it.
    pub fn set_jira_rest_account(&self, site: &str, email: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE app_settings SET jira_site_url = ?1, jira_rest_email = ?2 WHERE id = 1",
                params![site, email],
            )
            .map_err(|error| format!("Failed to save JIRA REST account: {error}"))?;
        Ok(())
    }

    /// Clear the stored REST email (called on disconnect; the site is left as-is).
    pub fn clear_jira_rest_email(&self) -> Result<(), String> {
        self.conn
            .execute("UPDATE app_settings SET jira_rest_email = NULL WHERE id = 1", [])
            .map_err(|error| format!("Failed to clear JIRA REST email: {error}"))?;
        Ok(())
    }
}
