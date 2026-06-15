use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use strum::{Display, EnumString, IntoStaticStr};

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum AgentKind {
    Codex,
    Claude,
    Antigravity,
    #[serde(rename = "opencode")]
    #[strum(serialize = "opencode")]
    OpenCode,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: i64,
    pub name: String,
    pub agent_kind: AgentKind,
    pub command: String,
    pub model: Option<String>,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileInput {
    pub id: Option<i64>,
    pub name: String,
    pub agent_kind: AgentKind,
    pub command: String,
    pub model: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AcpCapabilityState {
    Expected,
    Unknown,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AcpProviderCapabilities {
    pub session_load: AcpCapabilityState,
    pub permissions: AcpCapabilityState,
    pub images: AcpCapabilityState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AcpProviderLaunch {
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AcpProviderInfo {
    pub id: String,
    pub agent_kind: AgentKind,
    pub display_name: String,
    pub launch: AcpProviderLaunch,
    pub capabilities: AcpProviderCapabilities,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_kind_serializes_opencode_as_snake_case() {
        let serialized = serde_json::to_string(&AgentKind::OpenCode).unwrap();

        assert_eq!(serialized, r#""opencode""#);
        assert_eq!(
            serde_json::from_str::<AgentKind>(&serialized).unwrap(),
            AgentKind::OpenCode
        );
        assert_eq!(AgentKind::OpenCode.as_str(), "opencode");
    }
}
