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
        std::cerr << "Usage: brisk_cli <input_image> <output_image> [keypoints_json] [thresh] [octaves] [patternScale]\n";
        return 1;
    }

    const std::string input_path = argv[1];
    const std::string output_path = argv[2];
    const int thresh = cli::intArg(argc, argv, 4, "thresh", 30, 0, 255);
    const int octaves = cli::intArg(argc, argv, 5, "octaves", 3, 0, 8);
    const double patternScale = cli::doubleArg(argc, argv, 6, "patternScale", 1.0, 0.1, 10.0);

    cv::Mat image = cv::imread(input_path, cv::IMREAD_COLOR);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << input_path << "\n";
        return 2;
    }

    cv::Mat gray;
    cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);

    std::vector<cv::KeyPoint> keypoints;
    cv::BRISK::create(thresh, octaves, static_cast<float>(patternScale))->detect(gray, keypoints);

    cv::Mat output;
    cv::drawKeypoints(image, keypoints, output, cv::Scalar::all(-1), cv::DrawMatchesFlags::DRAW_RICH_KEYPOINTS);

    if (!cv::imwrite(output_path, output)) {
        std::cerr << "Failed to write output image: " << output_path << "\n";
        return 3;
    }

    const std::string json_path = cli::keypointsPath(argc, argv, output_path);
    if (!cli::writeKeypointsJson(json_path, input_path, output_path, image.size(),
                                 "BRISK", {{"thresh", thresh}, {"octaves", octaves}, {"patternScale", patternScale}},
                                 cli::enumerateKeypoints(keypoints))) return 3;

    std::cout << output_path << "\n";
    return 0;
}
