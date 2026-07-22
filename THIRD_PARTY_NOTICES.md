# Third-party inspirations

RoleAtlas's crawler architecture was informed by two MIT-licensed open-source projects:

- [Noel-Alex/Arachne](https://github.com/Noel-Alex/Arachne): the decoupled coordinator/worker crawl model, durable work queue, seen-set concept, and respectful-crawling emphasis. RoleAtlas replaces its Kafka/Redpanda transport with NATS JetStream and specializes extraction for job postings.
- [santifer/career-ops](https://github.com/santifer/career-ops): the qualification-first workflow, structured fit explanations, deduplication mindset, and application-pipeline concept.

No source files from either project are vendored here. Their names and trademarks remain the property of their respective owners.

The Signal Console visual direction was informed by the MIT-licensed [wangbh030722/vibe-nothing-ui-design](https://github.com/wangbh030722/vibe-nothing-ui-design) reference: monochrome hierarchy, hairline borders, sparse dot geometry, and red reserved for real attention states. RoleAtlas implements its own React components, glyphs, product layouts, and styles; it does not include Nothing Technology Limited fonts, icons, marks, or other proprietary brand assets.

## Geographic reference data

RoleAtlas generates its checked-in ISO country, ISO subdivision, region, and timezone reference files from these packages:

- `world-countries` 5.1.0, distributed under the Open Data Commons Open Database License (ODbL). Its country records are used as an attributed database source; the generated derivative remains subject to the ODbL.
- `countries-and-timezones` 3.9.0, distributed under the MIT License, copyright Manuel de la Torre.
- `@koshmoney/countries` 1.0.1-beta.1, distributed under the MIT License.

The generated files and exact source versions are recorded in `shared/geography/metadata.json`. The complete upstream license texts remain available in each installed package.
