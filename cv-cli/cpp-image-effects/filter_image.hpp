#pragma once

#include <vector>
#include <opencv2/imgproc.hpp>
#include "image_io.hpp"

namespace effects {

inline cv::Mat colorWithoutAlpha(const cv::Mat& image, cv::Mat& alpha) {
    if (image.channels() != 4) return image;
    cv::extractChannel(image, alpha, 3);
    cv::Mat color;
    cv::cvtColor(image, color, cv::COLOR_BGRA2BGR);
    return color;
}

inline cv::Mat restoreAlpha(const cv::Mat& color, const cv::Mat& alpha) {
    if (alpha.empty()) return color;
    std::vector<cv::Mat> channels;
    cv::split(color, channels);
    channels.push_back(alpha);
    cv::Mat output;
    cv::merge(channels, output);
    return output;
}

} // namespace effects
