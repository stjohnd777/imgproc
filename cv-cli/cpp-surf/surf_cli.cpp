#include <iostream>
#include <string>
#include <vector>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/features2d.hpp>
#include <opencv2/xfeatures2d.hpp>
#include "cli_args.hpp"
#include "keypoints_json.hpp"

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: surf_cli <input_image> <output_image> [keypoints_json] [hessianThreshold] [nOctaves] [nOctaveLayers]\n";
        return 1;
    }

    const std::string input_path = argv[1];
    const std::string output_path = argv[2];
    const double hessianThreshold = cli::doubleArg(argc, argv, 4, "hessianThreshold", 400.0, 1.0, 50000.0);
    const int nOctaves = cli::intArg(argc, argv, 5, "nOctaves", 4, 1, 8);
    const int nOctaveLayers = cli::intArg(argc, argv, 6, "nOctaveLayers", 3, 1, 8);

    cv::Mat image = cv::imread(input_path, cv::IMREAD_COLOR);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << input_path << "\n";
        return 2;
    }

    cv::Mat gray;
    cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);

    std::vector<cv::KeyPoint> keypoints;
    try {
        cv::xfeatures2d::SURF::create(hessianThreshold, nOctaves, nOctaveLayers)->detect(gray, keypoints);
    } catch (const cv::Exception& e) {
        // SURF is patented; OpenCV throws here unless it was built with OPENCV_ENABLE_NONFREE=ON.
        std::cerr << "SURF unavailable (OpenCV built without nonfree): " << e.what() << "\n";
        return 4;
    }

    cv::Mat output;
    cv::drawKeypoints(image, keypoints, output, cv::Scalar::all(-1), cv::DrawMatchesFlags::DRAW_RICH_KEYPOINTS);

    if (!cv::imwrite(output_path, output)) {
        std::cerr << "Failed to write output image: " << output_path << "\n";
        return 3;
    }

    const std::string json_path = cli::keypointsPath(argc, argv, output_path);
    if (!cli::writeKeypointsJson(json_path, input_path, output_path, image.size(),
                                 "SURF", {{"hessianThreshold", hessianThreshold}, {"nOctaves", nOctaves}, {"nOctaveLayers", nOctaveLayers}},
                                 cli::enumerateKeypoints(keypoints))) return 3;

    std::cout << output_path << "\n";
    return 0;
}
