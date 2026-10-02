#include <iostream>
#include <string>
#include <vector>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include "cli_args.hpp"
#include "keypoints_json.hpp"

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: corners_cli <input_image> <output_image> [keypoints_json] [maxCorners] [qualityLevel] [minDistance] [blockSize]\n";
        return 1;
    }

    const std::string input_path = argv[1];
    const std::string output_path = argv[2];
    const int maxCorners = cli::intArg(argc, argv, 4, "maxCorners", 500, 1, 100000);
    const double qualityLevel = cli::doubleArg(argc, argv, 5, "qualityLevel", 0.01, 0.000001, 1.0);
    const double minDistance = cli::doubleArg(argc, argv, 6, "minDistance", 10.0, 0.0, 1000.0);
    const int blockSize = cli::intArg(argc, argv, 7, "blockSize", 3, 1, 31);

    cv::Mat image = cv::imread(input_path, cv::IMREAD_COLOR);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << input_path << "\n";
        return 2;
    }

    cv::Mat gray;
    cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);

    // Shi-Tomasi corners.
    std::vector<cv::Point2f> corners;
    cv::goodFeaturesToTrack(gray, corners, maxCorners, qualityLevel, minDistance, cv::noArray(), blockSize);

    cv::Mat output = image.clone();
    for (const auto& corner : corners) {
        cv::circle(output, corner, 4, cv::Scalar(0, 0, 255), 2, cv::LINE_AA);
    }

    if (!cv::imwrite(output_path, output)) {
        std::cerr << "Failed to write output image: " << output_path << "\n";
        return 3;
    }

    const std::string json_path = cli::keypointsPath(argc, argv, output_path);
    if (!cli::writeKeypointsJson(json_path, input_path, output_path, image.size(),
                                 "SHI_TOMASI", {{"maxCorners", maxCorners}, {"qualityLevel", qualityLevel}, {"minDistance", minDistance}, {"blockSize", blockSize}},
                                 cli::enumerateKeypoints(corners))) return 3;

    std::cout << output_path << "\n";
    return 0;
}
