//! Egress policy for outbound crawler requests.
//!
//! Every URL is validated before a request (and before each redirect hop):
//! scheme must be HTTP(S), an optional deployment host allowlist restricts
//! which hosts may be contacted at all, and by default any hostname that
//! resolves to a loopback, private, link-local (including cloud metadata),
//! unspecified, or unique-local address is rejected so a crafted seed or
//! redirect cannot turn the crawler into an internal-network client.
//!
//! Residual limitation: validation resolves DNS separately from the eventual
//! connect, so a hostile authoritative server can still re-resolve between
//! check and connect (DNS rebinding). Per-hop revalidation bounds the window;
//! pinning the validated address would require a custom connector.

use std::{env, net::IpAddr};
use url::Url;

#[derive(Clone, Debug)]
pub struct EgressPolicy {
    allow_private: bool,
    host_allowlist: Option<Vec<String>>,
}

impl EgressPolicy {
    /// `SCOUT_ALLOW_PRIVATE_HOSTS` opts into private-address targets (fixture
    /// servers and local development only). `SCOUT_EGRESS_ALLOWLIST` is a
    /// comma-separated list of host suffixes; when set, no other host may be
    /// crawled.
    pub fn from_env() -> Self {
        let allowlist = env::var("SCOUT_EGRESS_ALLOWLIST").unwrap_or_default();
        let host_allowlist = if allowlist.trim().is_empty() {
            None
        } else {
            Some(
                allowlist
                    .split(',')
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(|value| value.to_ascii_lowercase())
                    .collect(),
            )
        };
        Self {
            allow_private: matches!(
                env::var("SCOUT_ALLOW_PRIVATE_HOSTS").as_deref(),
                Ok("true") | Ok("1")
            ),
            host_allowlist,
        }
    }

    pub fn new(allow_private: bool, host_allowlist: Option<Vec<String>>) -> Self {
        Self {
            allow_private,
            host_allowlist,
        }
    }

    pub fn allows_private_hosts(&self) -> bool {
        self.allow_private
    }

    pub async fn validate(&self, url: &Url) -> Result<(), String> {
        if !matches!(url.scheme(), "http" | "https") {
            return Err(format!("scheme {} is not crawlable", url.scheme()));
        }
        let Some(host) = url.host_str() else {
            return Err("URL has no host".into());
        };
        if let Some(allowlist) = &self.host_allowlist {
            let lowered = host.to_ascii_lowercase();
            let allowed = allowlist
                .iter()
                .any(|suffix| lowered == *suffix || lowered.ends_with(&format!(".{suffix}")));
            if !allowed {
                return Err(format!("host {host} is outside the egress allowlist"));
            }
        }
        if self.allow_private {
            return Ok(());
        }
        let port = url.port_or_known_default().unwrap_or(80);
        match tokio::net::lookup_host((host, port)).await {
            Ok(mut addresses) => {
                let blocked = addresses.find(|address| is_blocked_address(address.ip()));
                match blocked {
                    Some(address) => Err(format!(
                        "host {host} resolves to a non-public address ({})",
                        address.ip()
                    )),
                    None => Ok(()),
                }
            }
            Err(error) => Err(format!("host {host} could not be resolved: {error}")),
        }
    }
}

fn is_blocked_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.octets()[0] == 0
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || segments_link_local(v6)
                || v6
                    .to_ipv4_mapped()
                    .is_some_and(|mapped| is_blocked_address(IpAddr::V4(mapped)))
        }
    }
}

fn segments_link_local(value: std::net::Ipv6Addr) -> bool {
    (value.segments()[0] & 0xffc0) == 0xfe80
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn blocked(url: &str, policy: &EgressPolicy) -> bool {
        policy.validate(&Url::parse(url).unwrap()).await.is_err()
    }

    #[tokio::test]
    async fn rejects_literal_non_public_targets_by_default() {
        let policy = EgressPolicy::new(false, None);
        assert!(blocked("http://127.0.0.1:9000/board", &policy).await);
        assert!(blocked("http://10.1.2.3/jobs", &policy).await);
        assert!(blocked("http://172.16.5.4/jobs", &policy).await);
        assert!(blocked("http://192.168.1.10/jobs", &policy).await);
        assert!(blocked("http://169.254.169.254/latest/meta-data", &policy).await);
        assert!(blocked("http://[::1]/jobs", &policy).await);
        assert!(blocked("http://[fe80::1]/jobs", &policy).await);
        assert!(blocked("http://[fd00::1]/jobs", &policy).await);
        assert!(blocked("ftp://example.com/jobs", &policy).await);
    }

    #[tokio::test]
    async fn rejects_named_localhost_but_allows_when_opted_in() {
        let policy = EgressPolicy::new(false, None);
        assert!(blocked("http://localhost:8080/api/offers", &policy).await);
        let permissive = EgressPolicy::new(true, None);
        assert!(
            permissive
                .validate(&Url::parse("http://127.0.0.1:8080/x").unwrap())
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn host_allowlist_restricts_every_target_host() {
        // A public literal IP keeps the positive case free of external DNS.
        let policy = EgressPolicy::new(false, Some(vec!["93.184.216.34".into()]));
        assert!(
            policy
                .validate(&Url::parse("https://93.184.216.34/api/offers").unwrap())
                .await
                .is_ok()
        );
        assert!(
            policy
                .validate(&Url::parse("https://api.jobs.example.com/v1").unwrap())
                .await
                .is_err(),
            "hosts outside the allowlist are rejected before DNS"
        );
        assert!(
            policy
                .validate(&Url::parse("https://evil-93.184.216.34.example.com/").unwrap())
                .await
                .is_err(),
            "suffix matches must respect label boundaries"
        );
    }

    #[tokio::test]
    async fn unresolvable_hosts_are_rejected_not_swallowed() {
        let policy = EgressPolicy::new(false, None);
        assert!(blocked("http://roleatlas-does-not-exist.invalid/jobs", &policy).await);
    }
}
