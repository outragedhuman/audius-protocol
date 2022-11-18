FROM rust:1.60.0
# FROM debian:bullseye as base
# FROM --platform=linux/amd64 debian:bullseye as base

RUN apt-get update && \
    curl -fsSL https://deb.nodesource.com/setup_14.x | bash - && \
    apt-get install -y \ 
    build-essential clang cmake curl git jq nodejs \
    libudev-dev libssl-dev libhidapi-dev pkg-config 

WORKDIR /workspace

# RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- --default-toolchain 1.65.0 -y
# ENV PATH="/root/.cargo/bin:${PATH}"

#ARG SOLANA_VERSION=1.10.38
ARG SOLANA_VERSION=1.13.5
RUN curl https://codeload.github.com/solana-labs/solana/tar.gz/refs/tags/v$SOLANA_VERSION | tar xvz
RUN mv /workspace/solana-$SOLANA_VERSION /workspace/solana

WORKDIR /workspace/solana

RUN cargo build --bin solana-test-validator --release
RUN cargo build --bin solana-keygen --release
RUN cargo build --bin solana --release
RUN cargo build --bin cargo-build-bpf --release

RUN mkdir /workspace/bin

RUN cp target/release/solana-test-validator /workspace/bin/
RUN cp target/release/solana-keygen /workspace/bin/
RUN cp target/release/solana /workspace/bin/
RUN cp target/release/cargo-build-bpf /workspace/bin/


# TODO
RUN curl -fsSL https://deb.nodesource.com/setup_14.x | bash - && apt-get install -y nodejs
RUN npm install -g yarn @project-serum/anchor-cli@0.24.1

ENV PATH="/workspace/bin:${PATH}"
WORKDIR /usr/src/app

COPY anchor/audius-data/package.json anchor/audius-data/yarn.lock anchor/audius-data/
RUN cd anchor/audius-data && yarn install --network-timeout 1000000

# TODO
RUN apt update && apt-get install -y libc6-amd64-cross zlib1g-dev
RUN ln -s /usr/x86_64-linux-gnu/lib64/ /lib64

# RUN mkdir -p /lib/x86_64-linux-gnu/ && ln -s /lib/aarch64-linux-gnu/libz.so.1 /lib/x86_64-linux-gnu/libz.so.1

ENV LD_LIBRARY_PATH="/lib64:/usr/x86_64-linux-gnu/lib:/lib/aarch64-linux-gnu"

ENV CARGO_INCREMENTAL=1

ARG AUDIUS_ETH_REGISTRY_PRIVATE_KEY
ARG TRACK_LISTEN_COUNT_PRIVATE_KEY
ARG CLAIMABLE_TOKENS_PRIVATE_KEY
ARG REWARD_MANAGER_PRIVATE_KEY
ARG AUDIUS_DATA_PRIVATE_KEY

ENV RUSTFLAGS='-L /lib/aarch64-linux-gnu'

RUN echo ${RUSTFLAGS}

COPY . .

RUN --mount=type=cache,target=/usr/src/app/target-cache \
    --mount=type=cache,target=/root/.cache/solana \
    --mount=type=cache,target=/usr/local/cargo/registry \
    CARGO_TARGET_DIR=/usr/src/app/target-cache ./scripts/build.sh && \
    mkdir -p target target/debug anchor/audius-data/target && \
    cp -r target-cache/deploy target/ && \
    cp target-cache/debug/*-cli target/debug && \
    cp -r target-cache/deploy anchor/audius-data/target/