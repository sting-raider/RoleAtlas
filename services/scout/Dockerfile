FROM rust:1.87-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
COPY migrations ./migrations
COPY default_seeds.txt ./default_seeds.txt
RUN cargo build --release --locked || cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/scout-coordinator /usr/local/bin/scout-coordinator
COPY --from=builder /app/target/release/scout-worker /usr/local/bin/scout-worker
COPY --from=builder /app/target/release/scout-api /usr/local/bin/scout-api
EXPOSE 8080
CMD ["scout-worker"]
