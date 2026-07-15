FROM rust:1.87-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
COPY migrations ./migrations
COPY default_seeds.txt ./default_seeds.txt
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release --locked \
    && cp target/release/scout-coordinator /tmp/scout-coordinator \
    && cp target/release/scout-worker /tmp/scout-worker \
    && cp target/release/scout-api /tmp/scout-api

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /tmp/scout-coordinator /usr/local/bin/scout-coordinator
COPY --from=builder /tmp/scout-worker /usr/local/bin/scout-worker
COPY --from=builder /tmp/scout-api /usr/local/bin/scout-api
EXPOSE 8080
CMD ["scout-worker"]
