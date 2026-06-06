use serde::{Deserialize, Serialize};

/// A durable, named group of repos (VSCode-workspace style). `repo_ids` lists the
/// member repos ordered by their membership `position`. A repo may belong to more
/// than one workspace. See `docs/superpowers/specs` for the design.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: i64,
    pub name: String,
    pub repo_ids: Vec<i64>,
    pub created_at: String,
    pub updated_at: String,
}
