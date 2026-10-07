#pragma once

#include <cmath>
#include <stdexcept>
#include <string>
#include <opencv2/imgcodecs.hpp>
#include "cli_args.hpp"

namespace effects {

inline double number(int argc, char* argv[], int index, const char* name,
                     double fallback, double minimum = -1e300) {
    const double value = cli::doubleArg(argc, argv, index, name, fallback, minimum);
    if (!std::isfinite(value)) cli::fail(name, "finite");
    return value;
}

inline cv::Mat read(const std::string& filename) {
    cv::Mat image = cv::imread(filename, cv::IMREAD_UNCHANGED);
    if (image.empty()) throw std::runtime_error("Failed to load input image: " + filename);
    if ((image.depth() != CV_8U && image.depth() != CV_16U) ||
        (image.channels() != 1 && image.channels() != 3 && image.channels() != 4)) {
        throw std::runtime_error("Expected an 8-bit or 16-bit grayscale, RGB, or RGBA image");
    }
    return image;
}

inline void write(const std::string& filename, const cv::Mat& image) {
    if (!cv::imwrite(filename, image)) {
        throw std::runtime_error("Failed to write output image: " + filename);
    }
}

} // namespace effects
