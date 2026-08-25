use futures_util::StreamExt;
use reqwest::Client;
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::Mutex;
use url::Url;

/// Upper bound on a robots.txt body. Real files stay far below this; the cap
/// keeps a hostile origin from buffering unbounded bytes into memory.
const ROBOTS_MAX_BYTES: usize = 1024 * 1024;

type RobotsGroup = (Vec<String>, Vec<(bool, String)>, Option<Duration>);

#[derive(Clone)]
pub struct RobotsCache {
    client: Client,
    user_agent: String,
    cache: Arc<Mutex<HashMap<String, RobotsRules>>>,
}

#[derive(Clone, Default)]
struct RobotsRules {
    rules: Vec<(bool, String)>,
    crawl_delay: Option<Duration>,
}

impl RobotsCache {
    pub fn new(client: Client, user_agent: String) -> Self {
        Self {
            client,
            user_agent,
            cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn allowed(&self, url: &Url) -> bool {
        let Some(origin) = robots_origin(url) else {
            return false;
        };
        let cached = { self.cache.lock().await.get(&origin).cloned() };
        // A failed fetch (network error, oversized body) caches the empty
        // ruleset so the failure is not retried on every URL.
        let rules = match cached {
            Some(rules) => rules,
            None => {
                let fetched = self.fetch_rules(&origin).await.unwrap_or_default();
                self.cache.lock().await.insert(origin, fetched.clone());
                fetched
            }
        };
        rules.is_allowed(url.path())
    }

    pub async fn crawl_delay(&self, url: &Url) -> Option<Duration> {
        let origin = robots_origin(url)?;
        self.cache
            .lock()
            .await
            .get(&origin)
            .and_then(|rules| rules.crawl_delay)
    }

    async fn fetch_rules(&self, origin: &str) -> anyhow::Result<RobotsRules> {
        let response = self
            .client
            .get(format!("{origin}/robots.txt"))
            .send()
            .await?;
        if !response.status().is_success() {
            return Ok(RobotsRules::default());
        }
        // Bounded read: an oversized robots.txt fails the fetch (and so falls
        // back to the permissive default) instead of buffering unbounded bytes.
        let mut stream = response.bytes_stream();
        let mut body: Vec<u8> = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            if body.len() + chunk.len() > ROBOTS_MAX_BYTES {
                anyhow::bail!("robots.txt exceeds {ROBOTS_MAX_BYTES} bytes");
            }
            body.extend_from_slice(&chunk);
        }
        Ok(parse_robots(
            &String::from_utf8_lossy(&body),
            &self.user_agent,
        ))
    }
}

/// robots.txt is scoped to scheme://host:port — the same key used to fetch it.
/// Omitting the port (the previous key format) made `http://host` and
/// `http://host:8443` share one ruleset, letting a hostile port serve rules
/// that silently govern a different origin's crawl decisions.
fn robots_origin(url: &Url) -> Option<String> {
    let host = url.host_str()?;
    let port = url.port_or_known_default()?;
    Some(format!("{}://{}:{}", url.scheme(), host, port))
}

impl RobotsRules {
    fn is_allowed(&self, path: &str) -> bool {
        self.rules
            .iter()
            .filter(|(_, rule)| !rule.is_empty() && path.starts_with(rule.as_str()))
            .max_by_key(|(_, rule)| rule.len())
            .map(|(allow, _)| *allow)
            .unwrap_or(true)
    }
}

fn parse_robots(input: &str, user_agent: &str) -> RobotsRules {
    let target = user_agent
        .split('/')
        .next()
        .unwrap_or(user_agent)
        .to_ascii_lowercase();
    let mut groups: Vec<RobotsGroup> = Vec::new();
    let mut agents = Vec::new();
    let mut rules = Vec::new();
    let mut delay = None;

    for raw_line in input.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        let Some((field, value)) = line.split_once(':') else {
            continue;
        };
        let field = field.trim().to_ascii_lowercase();
        let value = value.trim();
        if field == "user-agent" {
            if !rules.is_empty() || delay.is_some() {
                groups.push((
                    std::mem::take(&mut agents),
                    std::mem::take(&mut rules),
                    delay.take(),
                ));
            }
            agents.push(value.to_ascii_lowercase());
        } else if !agents.is_empty() {
            match field.as_str() {
                "allow" => rules.push((true, value.to_string())),
                "disallow" => rules.push((false, value.to_string())),
                "crawl-delay" => {
                    if let Ok(seconds) = value.parse::<f64>() {
                        delay = Some(Duration::from_millis((seconds.max(0.0) * 1_000.0) as u64));
                    }
                }
                _ => {}
            }
        }
    }
    if !agents.is_empty() {
        groups.push((agents, rules, delay));
    }

    let mut selected = groups
        .iter()
        .filter(|(agents, _, _)| {
            agents
                .iter()
                .any(|agent| agent != "*" && target.contains(agent))
        })
        .collect::<Vec<_>>();
    if selected.is_empty() {
        selected = groups
            .iter()
            .filter(|(agents, _, _)| agents.iter().any(|agent| agent == "*"))
            .collect();
    }

    RobotsRules {
        rules: selected
            .iter()
            .flat_map(|(_, rules, _)| rules.clone())
            .collect(),
        crawl_delay: selected.iter().filter_map(|(_, _, delay)| *delay).max(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn longest_matching_rule_wins() {
        let rules = parse_robots(
            "User-agent: *\nDisallow: /jobs/private\nAllow: /jobs/private/public",
            "FirstRungScout",
        );
        assert!(!rules.is_allowed("/jobs/private/123"));
        assert!(rules.is_allowed("/jobs/private/public/123"));
    }

    #[test]
    fn cache_keys_distinguish_scheme_and_port() {
        let http = Url::parse("http://example.com/jobs").unwrap();
        let https = Url::parse("https://example.com/jobs").unwrap();
        let alt_port = Url::parse("http://example.com:8443/jobs").unwrap();
        let explicit_default = Url::parse("http://example.com:80/jobs").unwrap();
        let robots_origin_http = robots_origin(&http).unwrap();
        assert_ne!(robots_origin(&https).unwrap(), robots_origin_http);
        assert_ne!(robots_origin(&alt_port).unwrap(), robots_origin_http);
        // The explicit default port normalizes to the same origin.
        assert_eq!(
            robots_origin(&explicit_default).unwrap(),
            robots_origin_http
        );
    }

    #[test]
    fn originless_urls_are_rejected() {
        assert!(robots_origin(&Url::parse("mailto:a@b.example").unwrap()).is_none());
    }

    #[tokio::test]
    async fn oversized_robots_bodies_fail_the_fetch() {
        use tokio::io::AsyncWriteExt;
        // Single-response fixture: a robots.txt body larger than the cap,
        // delivered in chunks so the bounded read has to bail mid-stream.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("fixture binds");
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let oversized = vec![b'#'; ROBOTS_MAX_BYTES + 1];
            if let Ok((mut socket, _)) = listener.accept().await {
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\
                     Content-Length: {}\r\nConnection: close\r\n\r\n",
                    oversized.len()
                );
                let _ = socket.write_all(header.as_bytes()).await;
                let _ = socket.write_all(&oversized).await;
            }
            // Hold the listener open until the response is consumed.
            tokio::time::sleep(Duration::from_secs(5)).await;
        });

        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("client builds");
        let cache = RobotsCache::new(client, "FirstRungScout".into());
        let origin = format!("http://{address}");
        assert!(
            cache.fetch_rules(&origin).await.is_err(),
            "a body past ROBOTS_MAX_BYTES must fail instead of buffering"
        );
    }
}
