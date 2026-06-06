//! Shared serializable data types, split by domain and re-exported flat so every
//! `crate::models::Foo` path keeps resolving regardless of which submodule owns
//! the type.

mod agent;
mod error;
mod github;
mod jira;
mod review;
mod session;
mod settings;
mod task;
mod workspace;

pub use agent::*;
pub use error::*;
pub use github::*;
pub use jira::*;
pub use review::*;
pub use session::*;
pub use settings::*;
pub use task::*;
pub use workspace::*;

/// Generate the `as_str(&self) -> &'static str` shim that every string-backed enum
/// here would otherwise hand-write identically. Each enum derives strum's
/// `IntoStaticStr`, so `self.into()` yields its `serialize_all` rename — keeping
/// the SQL-param representation in one place.
macro_rules! enum_as_str {
    ($($ty:ty),+ $(,)?) => {
        $(
            impl $ty {
                pub fn as_str(&self) -> &'static str {
                    self.into()
                }
            }
        )+
    };
}

enum_as_str!(
    AgentKind,
    TaskStatus,
    ThemeMode,
    DensityMode,
    ReviewLoopStatus,
    ReviewVerdict,
    PrReviewStatus,
    PrReviewVerdict,
    PrReviewMode,
);
