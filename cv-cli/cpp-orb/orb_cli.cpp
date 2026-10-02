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
        std::cerr << "Usage: orb_cli <input_image> <output_image> [keypoints_json] [nfeatures] [scaleFactor] [nlevels] [fastThreshold]\n";
        return 1;
    }

    const std::string input_path = argv[1];
    const std::string output_path = argv[2];
    const int nfeatures = cli::intArg(argc, argv, 4, "nfeatures", 1000, 1, 100000);
    const double scaleFactor = cli::doubleArg(argc, argv, 5, "scaleFactor", 1.2, 1.01, 4.0);
    const int nlevels = cli::intArg(argc, argv, 6, "nlevels", 8, 1, 16);
    const int fastThreshold = cli::intArg(argc, argv, 7, "fastThreshold", 20, 0, 255);

    cv::Mat image = cv::imread(input_path, cv::IMREAD_COLOR);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << input_path << "\n";
        return 2;
    }

    cv::Mat gray;
    cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);

    std::vector<cv::KeyPoint> keypoints;
    cv::ORB::create(nfeatures, static_cast<float>(scaleFactor), nlevels, 31, 0, 2,
                    cv::ORB::HARRIS_SCORE, 31, fastThreshold)->detect(gray, keypoints);

    cv::Mat output;
    cv::drawKeypoints(image, keypoints, output, cv::Scalar::all(-1), cv::DrawMatchesFlags::DRAW_RICH_KEYPOINTS);

    if (!cv::imwrite(output_path, output)) {
        std::cerr << "Failed to write output image: " << output_path << "\n";
        return 3;
    }

    const std::string json_path = cli::keypointsPath(argc, argv, output_path);
    if (!cli::writeKeypointsJson(json_path, input_path, output_path, image.size(),
                                 "ORB", {{"nfeatures", nfeatures}, {"scaleFactor", scaleFactor}, {"nlevels", nlevels}, {"fastThreshold", fastThreshold}},
                                 cli::enumerateKeypoints(keypoints))) return 3;

    std::cout << output_path << "\n";
    return 0;
}
