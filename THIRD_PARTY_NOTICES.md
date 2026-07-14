# Third-party inspirations

FirstRung's crawler architecture was informed by two MIT-licensed open-source projects:

- [Noel-Alex/Arachne](https://github.com/Noel-Alex/Arachne): the decoupled coordinator/worker crawl model, durable work queue, seen-set concept, and respectful-crawling emphasis. FirstRung replaces its Kafka/Redpanda transport with NATS JetStream and specializes extraction for job postings.
- [santifer/career-ops](https://github.com/santifer/career-ops): the qualification-first workflow, structured fit explanations, deduplication mindset, and application-pipeline concept.

No source files from either project are vendored here. Their names and trademarks remain the property of their respective owners.
