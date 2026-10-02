#include <iostream>
#include <string>
#include <vector>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/features2d.hpp>
#include "cli_args.hpp"
#include "keypoints_json.hpp"

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: fast_cli <input_image> <output_image> [keypoints_json] [threshold] [nonmaxSuppression]\n";
        return 1;
    }

    const std::string input_path = argv[1];
    const std::string output_path = argv[2];
    const int threshold = cli::intArg(argc, argv, 4, "threshold", 20, 0, 255);
    const bool nonmax = cli::boolArg(argc, argv, 5, "nonmaxSuppression", true);

    cv::Mat image = cv::imread(input_path, cv::IMREAD_COLOR);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << input_path << "\n";
        return 2;
    }

    cv::Mat gray;
    cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);

    std::vector<cv::KeyPoint> keypoints;
    cv::FastFeatureDetector::create(threshold, nonmax)->detect(gray, keypoints);

    // FAST keypoints have no meaningful size/orientation, so draw plain markers instead of rich circles.
    cv::Mat output;
    cv::drawKeypoints(image, keypoints, output, cv::Scalar(0, 255, 0));

    if (!cv::imwrite(output_path, output)) {
        std::cerr << "Failed to write output image: " << output_path << "\n";
        return 3;
    }

    const std::string json_path = cli::keypointsPath(argc, argv, output_path);
    if (!cli::writeKeypointsJson(json_path, input_path, output_path, image.size(),
                                 "FAST", {{"threshold", threshold}, {"nonmaxSuppression", nonmax}},
                                 cli::enumerateKeypoints(keypoints, true))) return 3;

    std::cout << output_path << "\n";
    return 0;
}
