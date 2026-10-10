# Linux build environment for the Orbital Eyes native tools and the Linux packages (AppImage, tar.gz).
# Holds the toolchain only; the source is mounted at run time. See docker/README.md.
#
#   docker build -t orbital-eyes-linux-build -f docker/linux-build.Dockerfile docker
#   docker run --rm -v "$PWD":/src:ro -v oe-vcpkg-cache:/vcpkg-cache -v "$PWD/dist-linux":/out \
#       orbital-eyes-linux-build
FROM node:24-bookworm

ARG VCPKG_COMMIT=be1ae8e5c5bc79aac1b8f593f5554aee1cfde54f

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake ninja-build git curl zip unzip tar pkg-config \
        nasm autoconf autoconf-archive automake libtool python3 rsync \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/microsoft/vcpkg.git /opt/vcpkg \
    && git -C /opt/vcpkg checkout "${VCPKG_COMMIT}" \
    && /opt/vcpkg/bootstrap-vcpkg.sh -disableMetrics

ENV VCPKG_ROOT=/opt/vcpkg \
    VCPKG_BINARY_SOURCES="clear;files,/vcpkg-cache,readwrite" \
    VCPKG_FORCE_SYSTEM_BINARIES=1

COPY linux-build.sh /usr/local/bin/oe-linux-build
RUN chmod +x /usr/local/bin/oe-linux-build

WORKDIR /work
ENTRYPOINT ["oe-linux-build"]
