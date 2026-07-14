use reqwest::Client;
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::Mutex;
use url::Url;

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
        Self { client, user_agent, cache: Arc::new(Mutex::new(HashMap::new())) }
    }

    pub async fn allowed(&self, url: &Url) -> bool {
        let Some(host) = url.host_str() else { return false };
        let origin = format!("{}://{}", url.scheme(), host);
        let cached = { self.cache.lock().await.get(&origin).cloned() };
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
        let host = url.host_str()?;
        let origin = format!("{}://{}", url.scheme(), host);
        self.cache.lock().await.get(&origin).and_then(|rules| rules.crawl_delay)
    }

    async fn fetch_rules(&self, origin: &str) -> anyhow::Result<RobotsRules> {
        let response = self.client.get(format!("{origin}/robots.txt")).send().await?;
        if !response.status().is_success() {
            return Ok(RobotsRules::default());
        }
        let text = response.text().await?;
        Ok(parse_robots(&text, &self.user_agent))
    }
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
    let target = user_agent.split('/').next().unwrap_or(user_agent).to_ascii_lowercase();
    let mut groups: Vec<(Vec<String>, Vec<(bool, String)>, Option<Duration>)> = Vec::new();
    let mut agents = Vec::new();
    let mut rules = Vec::new();
    let mut delay = None;

    for raw_line in input.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        let Some((field, value)) = line.split_once(':') else { continue };
        let field = field.trim().to_ascii_lowercase();
        let value = value.trim();
        if field == "user-agent" {
            if !rules.is_empty() || delay.is_some() {
                groups.push((std::mem::take(&mut agents), std::mem::take(&mut rules), delay.take()));
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
        .filter(|(agents, _, _)| agents.iter().any(|agent| agent != "*" && target.contains(agent)))
        .collect::<Vec<_>>();
    if selected.is_empty() {
        selected = groups.iter().filter(|(agents, _, _)| agents.iter().any(|agent| agent == "*")).collect();
    }

    RobotsRules {
        rules: selected.iter().flat_map(|(_, rules, _)| rules.clone()).collect(),
        crawl_delay: selected.iter().filter_map(|(_, _, delay)| *delay).max(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn longest_matching_rule_wins() {
        let rules = parse_robots("User-agent: *\nDisallow: /jobs/private\nAllow: /jobs/private/public", "FirstRungScout");
        assert!(!rules.is_allowed("/jobs/private/123"));
        assert!(rules.is_allowed("/jobs/private/public/123"));
    }
}
