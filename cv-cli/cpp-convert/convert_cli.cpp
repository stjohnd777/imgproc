#include <algorithm>
#include <cmath>
#include <iostream>
#include <string>
#include <opencv2/core.hpp>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include "cli_args.hpp"

namespace {

int parseInterpolation(const std::string& mode) {
    if (mode == "linear" || mode == "1" || mode.empty()) return cv::INTER_LINEAR;
    if (mode == "nearest" || mode == "0") return cv::INTER_NEAREST;
    if (mode == "cubic" || mode == "2") return cv::INTER_CUBIC;
    if (mode == "area" || mode == "3") return cv::INTER_AREA;
    if (mode == "lanczos4" || mode == "4") return cv::INTER_LANCZOS4;
    return -1;
}

} // namespace

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: convert_cli <input_image> <output_image> [width] [height] [preserveRatio] [colorMode] [depthMode] [interpolation]\n"
                  << "  width, height: Target output size (0 or -1 means keep original)\n"
                  << "  preserveRatio: 1 to letterbox/pillarbox with black borders, 0 to stretch\n"
                  << "  colorMode: gray, rgb, keep\n"
                  << "  depthMode: u8, u16, keep\n"
                  << "  interpolation: linear, nearest, cubic, area, lanczos4\n";
        return 1;
    }

    const std::string input_path  = argv[1];
    const std::string output_path = argv[2];

    const int targetWidth        = cli::intArg(argc, argv, 3, "width", 0, -1, 32768);
    const int targetHeight       = cli::intArg(argc, argv, 4, "height", 0, -1, 32768);
    const bool preserveRatio     = cli::boolArg(argc, argv, 5, "preserveRatio", true);
    const std::string colorMode  = argc > 6 && std::string(argv[6]).size() > 0 ? argv[6] : "gray";
    const std::string depthMode  = argc > 7 && std::string(argv[7]).size() > 0 ? argv[7] : "u8";
    const std::string interpMode = argc > 8 && std::string(argv[8]).size() > 0 ? argv[8] : "linear";

    if (colorMode != "gray" && colorMode != "rgb" && colorMode != "keep") {
        std::cerr << "Invalid colorMode '" << colorMode << "': expected gray, rgb, or keep\n";
        return 1;
    }
    if (depthMode != "u8" && depthMode != "u16" && depthMode != "keep") {
        std::cerr << "Invalid depthMode '" << depthMode << "': expected u8, u16, or keep\n";
        return 1;
    }
    const int interp = parseInterpolation(interpMode);
    if (interp < 0) {
        std::cerr << "Invalid interpolation mode: " << interpMode << " (expected linear, nearest, cubic, area, lanczos4)\n";
        return 1;
    }

    // Always read unchanged to preserve 16-bit depth and channel count
    cv::Mat current = cv::imread(input_path, cv::IMREAD_UNCHANGED);
    if (current.empty()) {
        std::cerr << "Failed to load input image: " << input_path << "\n";
        return 2;
    }

    // 1. Color channel conversion
    if (colorMode == "gray") {
        if (current.channels() == 3) {
            cv::Mat gray;
            cv::cvtColor(current, gray, cv::COLOR_BGR2GRAY);
            current = gray;
        } else if (current.channels() == 4) {
            cv::Mat gray;
            cv::cvtColor(current, gray, cv::COLOR_BGRA2GRAY);
            current = gray;
        }
    } else if (colorMode == "rgb") {
        if (current.channels() == 1) {
            cv::Mat bgr;
            cv::cvtColor(current, bgr, cv::COLOR_GRAY2BGR);
            current = bgr;
        } else if (current.channels() == 4) {
            cv::Mat bgr;
            cv::cvtColor(current, bgr, cv::COLOR_BGRA2BGR);
            current = bgr;
        }
    }

    // 2. Bit depth conversion (proper scaling between [0..255] and [0..65535])
    const int inDepth = current.depth();
    if (depthMode == "u8") {
        if (inDepth == CV_16U) {
            cv::Mat u8;
            current.convertTo(u8, CV_8U, 1.0 / 256.0);
            current = u8;
        } else if (inDepth != CV_8U) {
            cv::Mat u8;
            current.convertTo(u8, CV_8U);
            current = u8;
        }
    } else if (depthMode == "u16") {
        if (inDepth == CV_8U) {
            cv::Mat u16;
            current.convertTo(u16, CV_16U, 257.0); // 255 * 257 = 65535
            current = u16;
        } else if (inDepth != CV_16U) {
            cv::Mat u16;
            current.convertTo(u16, CV_16U);
            current = u16;
        }
    }

    // 3. Resizing and Aspect Ratio preservation
    const int finalW = targetWidth > 0 ? targetWidth : current.cols;
    const int finalH = targetHeight > 0 ? targetHeight : current.rows;

    if (finalW != current.cols || finalH != current.rows) {
        if (!preserveRatio) {
            cv::Mat resized;
            cv::resize(current, resized, cv::Size(finalW, finalH), 0, 0, interp);
            current = resized;
        } else {
            const double scaleX = static_cast<double>(finalW) / current.cols;
            const double scaleY = static_cast<double>(finalH) / current.rows;
            const double scale = std::min(scaleX, scaleY);

            const int scaledW = std::clamp(static_cast<int>(std::round(current.cols * scale)), 1, finalW);
            const int scaledH = std::clamp(static_cast<int>(std::round(current.rows * scale)), 1, finalH);

            cv::Mat scaled;
            cv::resize(current, scaled, cv::Size(scaledW, scaledH), 0, 0, interp);

            // Create canvas filled with black (0)
            cv::Mat canvas;
            if (current.depth() == CV_16U) {
                canvas = cv::Mat::zeros(finalH, finalW, current.type());
            } else {
                canvas = cv::Mat::zeros(finalH, finalW, current.type());
            }

            // Center inside canvas
            const int offsetX = (finalW - scaledW) / 2;
            const int offsetY = (finalH - scaledH) / 2;
            cv::Rect roi(offsetX, offsetY, scaledW, scaledH);
            scaled.copyTo(canvas(roi));

            current = canvas;
        }
    }

    if (!cv::imwrite(output_path, current)) {
        std::cerr << "Failed to write output image: " << output_path << "\n";
        return 3;
    }

    std::cout << output_path << "\n";
    std::cout << "output: " << current.cols << "x" << current.rows
              << " depth=" << (current.depth() == CV_16U ? "16-bit" : "8-bit")
              << " channels=" << current.channels() << "\n";
    return 0;
}
