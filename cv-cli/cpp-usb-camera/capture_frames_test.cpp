#include <chrono>
#include <filesystem>
#include <iostream>
#include <stdexcept>

#include "capture_frames.hpp"

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

template <typename Action>
void require_failure(Action action) {
    bool failed = false;
    try {
        action();
    } catch (const std::exception&) {
        failed = true;
    }
    require(failed, "Expected an explicit failure.");
}

void test_capture(const std::filesystem::path& directory) {
    const auto output = directory / "finite";
    std::filesystem::create_directory(output);
    int reads = 0;
    auto read = [&](cv::Mat& frame) {
        ++reads;
        frame = cv::Mat(4, 6, CV_8UC3, cv::Scalar(reads, 20, 30));
        return true;
    };
    auto running = [] { return false; };
    require(capture_frames(read, running, output, 3) == 3, "Wrong finite count.");
    require(reads == 3, "Read beyond requested frame count.");
    for (int number = 1; number <= 3; ++number) {
        auto image = cv::imread(frame_path(output, number).string());
        require(image.rows == 4 && image.cols == 6, "Saved image dimensions differ.");
        require(image.at<cv::Vec3b>(0, 0)[0] == number, "Saved image contents differ.");
    }
    require(!std::filesystem::exists(frame_path(output, 4)), "Unexpected extra image.");
    require_failure([&] { capture_frames(read, running, output, 1); });
    require(cv::imread(frame_path(output, 1).string()).at<cv::Vec3b>(0, 0)[0] == 1,
            "Existing frame was overwritten.");

    const auto continuous = directory / "continuous";
    std::filesystem::create_directory(continuous);
    reads = 0;
    require(capture_frames(read, [&] { return reads == 4; }, continuous, -1) == 3,
            "Continuous capture did not stop after read cancellation.");
    require(capture_frames(read, [] { return true; }, continuous, -1) == 0,
            "Pre-cancelled capture should not read.");
    require_failure([&] {
        capture_frames([](cv::Mat&) { return false; }, running, directory, 1);
    });
    require_failure([&] {
        capture_frames([](cv::Mat&) { return true; }, running, directory, 1);
    });
    require_failure([&] { capture_frames(read, running, directory, 0); });
    require_failure([&] { capture_frames(read, running, directory, -2); });
    require_failure([&] { capture_frames(read, running, directory / "missing", 1); });
    require(frame_path(directory, 1000000).filename() == "frame_1000000.png",
            "Large frame numbers must not wrap.");
}

} // namespace

int main() {
    const auto directory = std::filesystem::temp_directory_path() /
        ("usb-camera-test-" + std::to_string(
            std::chrono::steady_clock::now().time_since_epoch().count()));
    if (!std::filesystem::create_directory(directory)) {
        std::cerr << "Could not create test directory.\n";
        return 1;
    }
    int result = 0;
    try {
        test_capture(directory);
        std::cout << "Capture tests passed.\n";
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        result = 1;
    }
    std::filesystem::remove_all(directory);
    return result;
}
