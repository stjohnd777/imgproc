#include <iostream>
#include <string>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include "cli_args.hpp"

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: canny_cli <input_image> <output_image> [low] [high] [apertureSize] [l2gradient]\n";
        return 1;
    }

    const std::string inputPath = argv[1];
    const std::string outputPath = argv[2];
    const int low = cli::intArg(argc, argv, 3, "low", 80, 0, 255);
    const int high = cli::intArg(argc, argv, 4, "high", 180, 0, 255);
    const int apertureSize = cli::oddIntArg(argc, argv, 5, "apertureSize", 3, 3, 7);
    const bool l2gradient = cli::boolArg(argc, argv, 6, "l2gradient", false);
    if (low > high) {
        std::cerr << "Canny thresholds must be 0..255, with low <= high\n";
        return 1;
    }

    const cv::Mat image = cv::imread(inputPath, cv::IMREAD_COLOR);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << inputPath << "\n";
        return 2;
    }

    cv::Mat gray;
    cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);
    cv::Mat edges;
    cv::Canny(gray, edges, low, high, apertureSize, l2gradient);

    if (!cv::imwrite(outputPath, edges)) {
        std::cerr << "Failed to write output image: " << outputPath << "\n";
        return 3;
    }

    std::cout << outputPath << "\n";
    return 0;
}
