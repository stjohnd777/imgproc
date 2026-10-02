#include <iostream>
#include <string>
#include <vector>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include "cli_args.hpp"

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: contours_cli <input_image> <output_image> [low] [high] [thickness] [externalOnly]\n";
        return 1;
    }

    const std::string inputPath = argv[1];
    const std::string outputPath = argv[2];
    const int low = cli::intArg(argc, argv, 3, "low", 80, 0, 255);
    const int high = cli::intArg(argc, argv, 4, "high", 180, 0, 255);
    const int thickness = cli::intArg(argc, argv, 5, "thickness", 2, 1, 20);
    const bool externalOnly = cli::boolArg(argc, argv, 6, "externalOnly", true);
    const cv::Mat image = cv::imread(inputPath, cv::IMREAD_COLOR);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << inputPath << "\n";
        return 2;
    }

    cv::Mat gray;
    cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);
    cv::Mat edges;
    cv::Canny(gray, edges, low, high);

    std::vector<std::vector<cv::Point>> contours;
    cv::findContours(edges, contours, externalOnly ? cv::RETR_EXTERNAL : cv::RETR_LIST, cv::CHAIN_APPROX_SIMPLE);

    cv::Mat output = image.clone();
    cv::drawContours(output, contours, -1, cv::Scalar(0, 255, 0), thickness, cv::LINE_AA);

    if (!cv::imwrite(outputPath, output)) {
        std::cerr << "Failed to write output image: " << outputPath << "\n";
        return 3;
    }

    std::cout << outputPath << "\n";
    return 0;
}
