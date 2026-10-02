#include <fstream>
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
        std::cerr << "Usage: sift_cli <input_image> <output_image> [keypoints_json]"
                     " [nfeatures] [nOctaveLayers] [contrastThreshold] [edgeThreshold] [sigma]\n";
        return 1;
    }

    const std::string input_path = argv[1];
    const std::string output_path = argv[2];
    // Empty or omitted JSON path derives a sidecar path from the preview.
    const int nfeatures = cli::intArg(argc, argv, 4, "nfeatures", 0, 0, 100000);
    const int nOctaveLayers = cli::intArg(argc, argv, 5, "nOctaveLayers", 3, 1, 8);
    const double contrastThreshold = cli::doubleArg(argc, argv, 6, "contrastThreshold", 0.04, 0.0, 1.0);
    const double edgeThreshold = cli::doubleArg(argc, argv, 7, "edgeThreshold", 10.0, 0.0, 100.0);
    const double sigma = cli::doubleArg(argc, argv, 8, "sigma", 1.6, 0.1, 10.0);

    cv::Mat image = cv::imread(input_path, cv::IMREAD_COLOR);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << input_path << "\n";
        return 2;
    }

    cv::Mat gray;
    cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);

    std::vector<cv::KeyPoint> keypoints;
    cv::SIFT::create(nfeatures, nOctaveLayers, contrastThreshold, edgeThreshold, sigma)->detect(gray, keypoints);

    cv::Mat output;
    cv::drawKeypoints(image, keypoints, output, cv::Scalar::all(-1), cv::DrawMatchesFlags::DRAW_RICH_KEYPOINTS);

    if (!cv::imwrite(output_path, output)) {
        std::cerr << "Failed to write output image: " << output_path << "\n";
        return 3;
    }

    const std::string json_path = cli::keypointsPath(argc, argv, output_path);
    if (!cli::writeKeypointsJson(json_path, input_path, output_path, image.size(),
                                 "SIFT", {{"nfeatures", nfeatures}, {"nOctaveLayers", nOctaveLayers}, {"contrastThreshold", contrastThreshold}, {"edgeThreshold", edgeThreshold}, {"sigma", sigma}},
                                 cli::enumerateKeypoints(keypoints))) return 3;

    std::cout << output_path << "\n";
    return 0;
}
