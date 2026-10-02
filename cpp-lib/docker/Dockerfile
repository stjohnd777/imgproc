# Ubuntu 24.04 LTS ("Noble") -- the latest LTS with mature apt/pip package coverage
# for OpenCV, PyTorch wheels, etc. Bump this once the newer LTS ecosystem catches up.
FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_MAJOR=20
ARG OPENCV_VERSION=4.10.0

# --- Base tooling + C++ toolchain -------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        gcc \
        g++ \
        gdb \
        cmake \
        make \
        ninja-build \
        git \
        curl \
        wget \
        unzip \
        ca-certificates \
        gnupg \
        lsb-release \
        pkg-config \
        software-properties-common \
    && rm -rf /var/lib/apt/lists/*

# --- C++ libraries -----------------------------------------------------------------
# libcgal-dev pulls in a large chain of transitive dependencies (GMP/MPFR, etc.) --
# that's expected for this dev image. OpenCV is intentionally NOT installed from apt
# here -- see the "Build OpenCV from source" step below for why.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libboost-all-dev \
        libeigen3-dev \
        libspdlog-dev \
        nlohmann-json3-dev \
        libyaml-cpp-dev \
        libtinyxml2-dev \
        libcurl4-openssl-dev \
        libcgal-dev \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# --- OpenCV, built from source with opencv_contrib + nonfree ------------------------
# apt's libopencv-dev is built WITHOUT opencv_contrib, so modules like xfeatures2d
# (where SURF lives -- patent-encumbered, requires OPENCV_ENABLE_NONFREE) aren't
# available that way. SIFT/ORB/FAST/KAZE/BRISK are in main modules, but SURF is not.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgtk-3-dev \
        libavcodec-dev \
        libavformat-dev \
        libswscale-dev \
        libv4l-dev \
        libjpeg-dev \
        libpng-dev \
        libtiff-dev \
        libtbb-dev \
        libatlas-base-dev \
        gfortran \
    && rm -rf /var/lib/apt/lists/* \
    && git clone --depth 1 --branch ${OPENCV_VERSION} https://github.com/opencv/opencv.git /tmp/opencv \
    && git clone --depth 1 --branch ${OPENCV_VERSION} https://github.com/opencv/opencv_contrib.git /tmp/opencv_contrib \
    && cmake -S /tmp/opencv -B /tmp/opencv/build -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/usr/local \
        -DOPENCV_EXTRA_MODULES_PATH=/tmp/opencv_contrib/modules \
        -DOPENCV_ENABLE_NONFREE=ON \
        -DBUILD_TESTS=OFF \
        -DBUILD_PERF_TESTS=OFF \
        -DBUILD_EXAMPLES=OFF \
        -DBUILD_opencv_python3=ON \
        -DWITH_TBB=ON \
    && cmake --build /tmp/opencv/build --parallel "$(nproc)" \
    && cmake --install /tmp/opencv/build \
    && ldconfig \
    && rm -rf /tmp/opencv /tmp/opencv_contrib

# --- GTest -----------------------------------------------------------------
# Ubuntu's libgtest-dev only ships sources, not prebuilt libraries -- build them once here.
RUN apt-get update && apt-get install -y --no-install-recommends libgtest-dev libgmock-dev \
    && cd /usr/src/googletest \
    && cmake -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --target install \
    && rm -rf /var/lib/apt/lists/* build

# --- Crow (header-only C++ REST framework) -----------------------------------------
# Not packaged in apt, so vendor the headers directly.
RUN git clone --depth 1 --branch v1.2.0 https://github.com/CrowCpp/Crow.git /tmp/crow \
    && cp -r /tmp/crow/include/* /usr/local/include/ \
    && rm -rf /tmp/crow

# --- Python + data science / ML stack -----------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        python3-dev \
    && rm -rf /var/lib/apt/lists/*

# CPU-only PyTorch wheel -- swap the index URL for a CUDA build if/when this runs on a GPU host.
RUN pip3 install --no-cache-dir --break-system-packages \
        numpy \
        pandas \
        matplotlib \
        scikit-learn \
        jupyterlab \
        notebook \
        ipykernel \
        torch --index-url https://download.pytorch.org/whl/cpu

# --- Node.js (for tooling / eventual REST client-side testing) ---------------------
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# --- MongoDB (server + shell) -------------------------------------------------------
RUN curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/7.0 multiverse" \
        > /etc/apt/sources.list.d/mongodb-org-7.0.list \
    && apt-get update && apt-get install -y --no-install-recommends mongodb-org \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

CMD ["/bin/bash"]
