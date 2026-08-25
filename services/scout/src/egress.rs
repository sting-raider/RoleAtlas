//! Egress policy for outbound crawler requests.
//!
//! Every URL is validated before a request (and before each redirect hop):
//! scheme must be HTTP(S), an optional deployment host allowlist restricts
//! which hosts may be contacted at all, and by default any hostname that
//! resolves to a non-global address — loopback, private, link-local (including
//! cloud metadata), CGNAT, benchmarking, IETF protocol assignments,
//! documentation ranges, multicast, reserved space, unspecified, or
//! unique-local — is rejected so a crafted seed or redirect cannot turn the
//! crawler into an internal-network client.
//!
//! The same filter also runs inside [`PinnedResolver`], which is installed as
//! the HTTP client's DNS resolver: the addresses handed to the connection
//! layer are exactly the ones that passed the private-address check, so a
//! hostile authoritative server cannot re-resolve between validation and
//! connect (the DNS-rebinding window from D-023).

use std::{env, net::IpAddr, ops::RangeInclusive};
use url::Url;

/// NAT64 well-known prefix 64:ff9b::/96 (first six segments).
const NAT64_PREFIX_SEGMENTS: [u16; 6] = [0x0064, 0xff9b, 0, 0, 0, 0];

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

/// Shared-address-space (CGNAT) block. Also covers cloud metadata services
/// that live inside it, e.g. Alibaba's 100.100.200.200.
const CGNAT_OCTET_RANGE: RangeInclusive<u8> = 64..=127;
/// 198.18.0.0/15 benchmarking block.
const BENCHMARKING_SECOND_OCTETS: RangeInclusive<u8> = 18..=19;

fn is_blocked_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_blocked_ipv4(&v4.octets()),
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || segments_link_local(v6)
                || v6.is_multicast()
                // NAT64 embeds the IPv4 target in the last 4 octets.
                || v6.segments()[..6] == NAT64_PREFIX_SEGMENTS
                    && is_blocked_ipv4(&embedded_v4(v6))
                // IPv4-compatible ::/96 (deprecated): same embedded-v4 test.
                || v6.segments()[..6] == [0; 6] && is_blocked_ipv4(&embedded_v4(v6))
                || v6
                    .to_ipv4_mapped()
                    .is_some_and(|mapped| is_blocked_address(IpAddr::V4(mapped)))
        }
    }
}

fn is_blocked_ipv4(octets: &[u8; 4]) -> bool {
    let [first, second, third, _] = *octets;
    first == 0 // "this network"
        || first == 10
        || first == 127
        || (first == 100 && CGNAT_OCTET_RANGE.contains(&second))
        || (first == 169 && second == 254)
        || (first == 172 && (16..=31).contains(&second))
        || (first == 192 && second == 168)
        || (first == 192 && second == 0) // IETF protocol assignments + TEST-NET-1
        || (first == 198 && BENCHMARKING_SECOND_OCTETS.contains(&second))
        || (first == 198 && second == 51 && third == 100) // TEST-NET-2
        || (first == 203 && second == 0 && third == 113) // TEST-NET-3
        || first >= 224 // multicast through reserved/broadcast space
}

/// Last four octets of an IPv6 address as the embedded IPv4 address.
fn embedded_v4(value: std::net::Ipv6Addr) -> [u8; 4] {
    let segments = value.segments();
    [
        (segments[6] >> 8) as u8,
        (segments[6] & 0xff) as u8,
        (segments[7] >> 8) as u8,
        (segments[7] & 0xff) as u8,
    ]
}

fn segments_link_local(value: std::net::Ipv6Addr) -> bool {
    (value.segments()[0] & 0xffc0) == 0xfe80
}

/// DNS resolver installed on the crawler's HTTP client. Every lookup is
/// filtered through [`is_blocked_address`] at resolve time, so the connection
/// layer can only see addresses that satisfy the egress policy — closing the
/// validate-then-connect rebinding window that per-hop revalidation alone
/// leaves open.
pub struct PinnedResolver {
    allow_private: bool,
}

impl PinnedResolver {
    pub fn new(policy: &EgressPolicy) -> Self {
        Self {
            allow_private: policy.allow_private,
        }
    }
}

impl reqwest::dns::Resolve for PinnedResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let allow_private = self.allow_private;
        Box::pin(async move {
            let host = name.as_str().to_owned();
            let resolved = tokio::net::lookup_host((host.as_str(), 0))
                .await
                .map_err(|error| -> Box<dyn std::error::Error + Send + Sync> { error.into() })?;
            // Only vetted addresses reach the connection layer; an empty list
            // means every answer pointed at a non-global address.
            let vetted: Vec<_> = if allow_private {
                resolved.collect()
            } else {
                resolved
                    .filter(|addr| !is_blocked_address(addr.ip()))
                    .collect()
            };
            if vetted.is_empty() && !allow_private {
                return Err(format!("host {host} resolves only to non-public addresses").into());
            }
            let addrs: reqwest::dns::Addrs = Box::new(vetted.into_iter());
            Ok(addrs)
        })
    }
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

    #[tokio::test]
    async fn pinned_resolver_filters_and_errors_like_validate() {
        use reqwest::dns::Resolve as _;
        use std::net::SocketAddr;
        use std::str::FromStr;

        let resolver = PinnedResolver::new(&EgressPolicy::new(false, None));

        // Literal hosts skip DNS entirely in reqwest, so exercise the
        // filtering logic through a name that always resolves to loopback.
        let name = reqwest::dns::Name::from_str("localhost").expect("localhost is a valid name");
        let result = resolver.resolve(name).await;
        assert!(
            result.is_err(),
            "a loopback-resolving name must fail inside the resolver"
        );

        // A real public name (dns.google) must survive the filter; CI hosts
        // without outbound DNS would fail this lookup, which the test then
        // reports honestly instead of asserting blindly.
        match tokio::net::lookup_host(("dns.google", 0)).await {
            Ok(mut addrs) => {
                assert!(
                    addrs.all(|addr: SocketAddr| !addr.ip().is_loopback()),
                    "fixture assumes public answers for dns.google"
                );
                let name = reqwest::dns::Name::from_str("dns.google").expect("valid name");
                let vetted = resolver.resolve(name).await.expect("public host passes");
                assert!(vetted.count() > 0, "vetted addresses are non-empty");
            }
            Err(error) => panic!("outbound DNS unavailable, cannot exercise filter: {error}"),
        }
    }

    #[test]
    fn blocks_extended_non_global_ipv4_classes() {
        // CGNAT / Tailscale, including Alibaba's metadata address.
        assert!(is_blocked_address("100.64.0.1".parse().unwrap()));
        assert!(is_blocked_address("100.100.200.200".parse().unwrap()));
        assert!(!is_blocked_address("100.63.255.255".parse().unwrap()));
        assert!(!is_blocked_address("100.128.0.1".parse().unwrap()));
        // Benchmarking.
        assert!(is_blocked_address("198.18.0.5".parse().unwrap()));
        assert!(is_blocked_address("198.19.255.255".parse().unwrap()));
        // IETF protocol assignments and TEST-NET-1/2/3 documentation space.
        assert!(is_blocked_address("192.0.0.10".parse().unwrap()));
        assert!(is_blocked_address("192.0.2.9".parse().unwrap()));
        assert!(is_blocked_address("198.51.100.7".parse().unwrap()));
        assert!(is_blocked_address("203.0.113.99".parse().unwrap()));
        // Reserved (includes the broadcast address).
        assert!(is_blocked_address("240.1.2.3".parse().unwrap()));
        assert!(is_blocked_address("255.255.255.255".parse().unwrap()));
        // Multicast.
        assert!(is_blocked_address("224.0.0.251".parse().unwrap()));
        assert!(is_blocked_address("239.255.255.250".parse().unwrap()));
    }

    #[test]
    fn blocks_extended_non_global_ipv6_classes() {
        // Multicast.
        assert!(is_blocked_address("ff02::fb".parse().unwrap()));
        assert!(is_blocked_address("ff05::1:3".parse().unwrap()));
        // NAT64 with an embedded private IPv4 target.
        assert!(is_blocked_address("64:ff9b::10.0.0.2".parse().unwrap()));
        assert!(is_blocked_address(
            "64:ff9b::169.254.169.254".parse().unwrap()
        ));
        // NAT64 embedding a public address stays reachable.
        assert!(!is_blocked_address("64:ff9b::1.1.1.1".parse().unwrap()));
        // Deprecated IPv4-compatible form inherits the IPv4 verdict.
        assert!(is_blocked_address("::192.168.0.5".parse().unwrap()));
        assert!(is_blocked_address("::127.0.0.1".parse().unwrap()));
        assert!(!is_blocked_address("::8.8.8.8".parse().unwrap()));
    }

    #[test]
    fn global_unicast_targets_stay_allowed() {
        for public in [
            "1.1.1.1",
            "8.8.8.8",
            "93.184.216.34",
            "2606:4700::1111",
            "2001:4860:4860::8888",
            "::ffff:1.1.1.1", // v4-mapped public address
        ] {
            assert!(
                !is_blocked_address(public.parse().unwrap()),
                "{public} must remain crawlable"
            );
        }
    }
}
