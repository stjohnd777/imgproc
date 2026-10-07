#pragma once

#include <cstdint>
#include <filesystem>
#include <iomanip>
#include <limits>
#include <sstream>
#include <stdexcept>

#include <opencv2/core.hpp>
#include <opencv2/imgcodecs.hpp>

inline std::filesystem::path frame_path(const std::filesystem::path& directory,  std::uint64_t number) {
    std::ostringstream name;
    name << "frame_" << std::setw(6) << std::setfill('0') << number << ".png";
    return directory / name.str();
}

template <typename ReadFrame, typename ShouldStop>
std::uint64_t capture_frames(ReadFrame read_frame, ShouldStop should_stop, const std::filesystem::path& output_dir, int frame_count) {
    
    if (frame_count == 0 || frame_count < -1) {
        throw std::invalid_argument("frame_count must be positive or -1.");
    }
    std::uint64_t saved = 0;
    while (!should_stop() && (frame_count == -1 || saved < static_cast<std::uint64_t>(frame_count))) {
        if (saved == std::numeric_limits<std::uint64_t>::max()) {
            throw std::runtime_error("Frame counter exhausted.");
        }
        cv::Mat frame;
        const bool read = read_frame(frame);

        if (should_stop()) break;

        if (!read || frame.empty()) {
            throw std::runtime_error("Camera failed to provide frame " + std::to_string(saved + 1) + " after saving " + std::to_string(saved) + " frame(s).");
        }
        const auto path = frame_path(output_dir, saved + 1);
        if (std::filesystem::exists(path)) {
            throw std::runtime_error("Refusing to overwrite existing frame: " + path.string());
        }
        if (!cv::imwrite(path.string(), frame)) {
            throw std::runtime_error("Failed to write image: " + path.string());
        }
        ++saved;
    }
    return saved;
}
