#include <csignal>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>

#include <opencv2/videoio.hpp>

#include "cli_args.hpp"
#include "capture_frames.hpp"

namespace {

volatile std::sig_atomic_t stop_requested = 0;

struct Parameters {
    int device_id = 0;
    int frame_count = -1;
    int height = 0;
    int width = 0;
    std::filesystem::path output_dir;

    bool has_resolution() const {
        return height > 0 && width > 0;
    }
};

enum class ValidationResult {
    ready,
    help,
    invalid_usage
};

void request_stop(int) {
    stop_requested = 1;
}

void print_usage(std::ostream& stream) {
    stream << "Usage: usb_camera_cli <device_id> <output_dir> "
              "[frame_count] [height width]\n"
           << "  device_id: Nonnegative OpenCV camera index (0 is the usual default)\n"
           << "  frame_count: Positive number of frames, or -1 for continuous capture (default)\n"
           << "  height width: Optional positive dimensions, in that order\n"
           << "  Writes frame_000001.png, frame_000002.png, ... without overwriting files\n"
           << "  Stop continuous capture with Ctrl+C; no preview window is opened\n";
}

ValidationResult validate(int argc, char** argv, Parameters& parameters) {

    if (argc == 2 && std::string(argv[1]) == "--help") {
        print_usage(std::cout);
        return ValidationResult::help;
    }
    if (argc != 3 && argc != 4 && argc != 6) {
        print_usage(std::cerr);
        return ValidationResult::invalid_usage;
    }
    if (std::string(argv[1]).empty() || std::string(argv[2]).empty() ||
        (argc >= 4 && std::string(argv[3]).empty()) ||
        (argc == 6 && (std::string(argv[4]).empty() || std::string(argv[5]).empty()))) {
        throw std::invalid_argument("Arguments must not be empty.");
    }

    Parameters parsed;
    parsed.device_id = cli::intArg(argc, argv, 1, "device_id", 0, 0);
    parsed.frame_count = cli::intArg(argc, argv, 3, "frame_count", -1, -1);
    if (parsed.frame_count == 0) {
        throw std::invalid_argument("frame_count must be positive or -1.");
    }
    parsed.height = cli::intArg(argc, argv, 4, "height", 0, 1);
    parsed.width = cli::intArg(argc, argv, 5, "width", 0, 1);
    parsed.output_dir = argv[2];
    std::filesystem::create_directories(parsed.output_dir);

    if (!std::filesystem::is_directory(parsed.output_dir)) {
        throw std::runtime_error("Output path is not a directory: " + parsed.output_dir.string());
    }

    if (std::filesystem::exists(frame_path(parsed.output_dir, 1))) {
        throw std::runtime_error("Output already contains frame_000001.png; use another directory.");
    }
    
    parameters = std::move(parsed);
    return ValidationResult::ready;
}

int run(int argc, char** argv) {

    Parameters parameters;

    switch (validate(argc, argv, parameters)) {
        case ValidationResult::help:
            return 0;
        case ValidationResult::invalid_usage:
            return 1;
        case ValidationResult::ready:
            break;
    }
    if (std::signal(SIGINT, request_stop) == SIG_ERR || std::signal(SIGTERM, request_stop) == SIG_ERR) {
        throw std::runtime_error("Could not install capture shutdown handlers.");
    }
    if (stop_requested) return 0;

    cv::VideoCapture camera;
    if (!camera.open(parameters.device_id, cv::CAP_ANY)) {
        throw std::runtime_error("Could not open camera device " + std::to_string(parameters.device_id) + ". Check its availability and camera permissions.");
    }
    if (parameters.has_resolution()) {
        const bool width_set = camera.set(cv::CAP_PROP_FRAME_WIDTH, parameters.width);
        const bool height_set = camera.set(cv::CAP_PROP_FRAME_HEIGHT, parameters.height);
        if (!width_set || !height_set) {
            std::cerr << "Warning: camera backend did not accept all requested resolution settings.\n";
        }
    }
    std::cout << "Camera " << parameters.device_id << " opened (" << camera.getBackendName()  << "). Writing PNGs to " << parameters.output_dir << ". Stop with Ctrl+C.\n";

    bool first_frame = true;
    const auto saved = capture_frames( 
        [&](cv::Mat& frame) {
            const bool read = camera.read(frame);
            if (read && !frame.empty() && first_frame) {
                std::cout << "Actual frame size: " << frame.cols << " x " << frame.rows << "\n";
                if (parameters.has_resolution() && (frame.cols != parameters.width || frame.rows != parameters.height)) {
                    std::cerr << "Warning: requested " << parameters.width << " x " << parameters.height<< ", received " << frame.cols << " x " << frame.rows << ".\n";
                }
                first_frame = false;
            }
            return read;
        },
        [] {  return stop_requested != 0; },
        parameters.output_dir, parameters.frame_count);

    std::cout << "Saved " << saved << " frame(s)" << (stop_requested ? " before shutdown.\n" : ".\n");

    return 0;
}

} // namespace

int main(int argc, char** argv) {
    try {
        return run(argc, argv);
    } catch (const cv::Exception& error) {
        std::cerr << "OpenCV error: " << error.what() << "\n";
    } catch (const std::exception& error) {
        std::cerr << "ERROR: " << error.what() << "\n";
    }
    return 2;
}
