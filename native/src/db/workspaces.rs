use super::rows::{rows, workspace_from_row};
use super::{now, Database};
use crate::models::Workspace;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;

impl Database {
    pub fn list_workspaces(&self) -> Result<Vec<Workspace>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, name, created_at, updated_at, collapsed FROM workspaces ORDER BY name",
            )
            .map_err(|error| error.to_string())?;
        let mut workspaces = rows(stmt
            .query_map([], workspace_from_row)
            .map_err(|error| error.to_string())?)?;
        for workspace in workspaces.iter_mut() {
            workspace.repo_ids = self.workspace_repo_ids(workspace.id)?;
        }
        Ok(workspaces)
    }

    pub fn workspace_by_id(&self, id: i64) -> Result<Option<Workspace>, String> {
        let workspace = self
            .conn
            .query_row(
                "SELECT id, name, created_at, updated_at, collapsed FROM workspaces WHERE id = ?1",
                params![id],
                workspace_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())?;
        match workspace {
            Some(mut workspace) => {
                workspace.repo_ids = self.workspace_repo_ids(workspace.id)?;
                Ok(Some(workspace))
            }
            None => Ok(None),
        }
    }

    pub fn create_workspace(
        &self,
        name: String,
        repo_ids: Vec<i64>,
    ) -> Result<Workspace, String> {
        let name = trimmed_name(name)?;
        // A workspace with no repos would resolve to an empty repo-scope filter
        // that hides every project, so reject it (the UI also gates the button).
        if repo_ids.is_empty() {
            return Err("Select at least one repository for the workspace".to_string());
        }
        self.ensure_unique_workspace_name(&name, None)?;
        let now = now();
        // The workspace row and its membership are written together so a bad
        // member id (a missing repo tripping the FK) rolls back the whole insert
        // rather than leaving a memberless workspace behind.
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|error| format!("Failed to begin workspace transaction: {error}"))?;
        tx.execute(
            "INSERT INTO workspaces (name, created_at, updated_at) VALUES (?1, ?2, ?2)",
            params![name, now],
        )
        .map_err(|error| format!("Failed to save workspace: {error}"))?;
        let workspace_id = tx.last_insert_rowid();
        replace_workspace_repos(&tx, workspace_id, &repo_ids)?;
        tx.commit()
            .map_err(|error| format!("Failed to commit workspace: {error}"))?;

        self.workspace_by_id(workspace_id)?
            .ok_or_else(|| "Workspace was saved but could not be loaded".into())
    }

    pub fn update_workspace(
        &self,
        id: i64,
        name: String,
        repo_ids: Vec<i64>,
    ) -> Result<Workspace, String> {
        let name = trimmed_name(name)?;
        if repo_ids.is_empty() {
            return Err("Select at least one repository for the workspace".to_string());
        }
        self.workspace_by_id(id)?
            .ok_or_else(|| "Workspace not found".to_string())?;
        self.ensure_unique_workspace_name(&name, Some(id))?;

        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|error| format!("Failed to begin workspace transaction: {error}"))?;
        tx.execute(
            "UPDATE workspaces SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now(), id],
        )
        .map_err(|error| format!("Failed to update workspace: {error}"))?;
        replace_workspace_repos(&tx, id, &repo_ids)?;
        tx.commit()
            .map_err(|error| format!("Failed to commit workspace: {error}"))?;

        self.workspace_by_id(id)?
            .ok_or_else(|| "Workspace not found after update".into())
    }

    pub fn delete_workspace(&self, id: i64) -> Result<(), String> {
        // `workspace_repos` rows are removed by the ON DELETE CASCADE constraint.
        self.conn
            .execute("DELETE FROM workspaces WHERE id = ?1", params![id])
            .map_err(|error| format!("Failed to delete workspace: {error}"))?;
        Ok(())
    }

    /// Persist the sidebar fold state of a workspace's nested agent list. A pure
    /// UI preference, so it intentionally does not bump `updated_at`.
    pub fn set_workspace_collapsed(&self, id: i64, collapsed: bool) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE workspaces SET collapsed = ?1 WHERE id = ?2",
                params![collapsed, id],
            )
            .map_err(|error| format!("Failed to update workspace: {error}"))?;
        Ok(())
    }

    /// Reject a name already used by another workspace (case-insensitive), so the
    /// switcher never shows two indistinguishable entries. `exclude_id` lets an
    /// update keep its own name.
    fn ensure_unique_workspace_name(&self, name: &str, exclude_id: Option<i64>) -> Result<(), String> {
        let existing: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM workspaces WHERE name = ?1 COLLATE NOCASE",
                params![name],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        match existing {
            Some(id) if Some(id) != exclude_id => {
                Err(format!("A workspace named \"{name}\" already exists"))
            }
            _ => Ok(()),
        }
    }

    fn workspace_repo_ids(&self, workspace_id: i64) -> Result<Vec<i64>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT repo_id FROM workspace_repos WHERE workspace_id = ?1 ORDER BY position")
            .map_err(|error| error.to_string())?;
        let result = rows(stmt
            .query_map(params![workspace_id], |row| row.get::<_, i64>(0))
            .map_err(|error| error.to_string())?);
        result
    }
}

fn trimmed_name(name: String) -> Result<String, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Workspace name cannot be empty".to_string());
    }
    Ok(name)
}

/// Replace a workspace's membership with `repo_ids`, in the given order. Duplicate
/// ids are dropped (the composite primary key forbids them) while the first
/// occurrence keeps its position. Runs inside the caller's transaction so a failure
/// rolls the whole create/update back.
fn replace_workspace_repos(
    conn: &Connection,
    workspace_id: i64,
    repo_ids: &[i64],
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM workspace_repos WHERE workspace_id = ?1",
        params![workspace_id],
    )
    .map_err(|error| format!("Failed to clear workspace repos: {error}"))?;

    let mut seen = HashSet::new();
    let mut position: i64 = 0;
    for repo_id in repo_ids {
        if !seen.insert(*repo_id) {
            continue;
        }
        conn.execute(
            "INSERT INTO workspace_repos (workspace_id, repo_id, position) VALUES (?1, ?2, ?3)",
            params![workspace_id, repo_id, position],
        )
        .map_err(|error| format!("Failed to save workspace repo: {error}"))?;
        position += 1;
    }
    Ok(())
}
