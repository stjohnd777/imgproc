#include <cmath>
#include <iostream>
#include <string>
#include <vector>
#include <opencv2/calib3d.hpp>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

int main(int argc, char* argv[]) {
    if (argc < 11) {
        std::cerr << "Usage: undistort_cli <input_image> <output_image> <fx> <fy> <cx> <cy> <k1> <k2> <p1> <p2> [k3]\n";
        return 1;
    }

    const std::string input_path = argv[1];
    const std::string output_path = argv[2];

    std::vector<double> values;
    for (int i = 3; i < argc && i < 12; ++i) {
        try {
            values.push_back(std::stod(argv[i]));
        } catch (const std::exception&) {
            std::cerr << "Not a number: " << argv[i] << "\n";
            return 1;
        }
        if (!std::isfinite(values.back())) {
            std::cerr << "Not a finite number: " << argv[i] << "\n";
            return 1;
        }
    }
    const double fx = values[0], fy = values[1], cx = values[2], cy = values[3];
    if (fx <= 0 || fy <= 0) {
        std::cerr << "fx and fy must be positive\n";
        return 1;
    }

    const cv::Mat image = cv::imread(input_path, cv::IMREAD_COLOR);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << input_path << "\n";
        return 2;
    }

    const cv::Mat K = (cv::Mat_<double>(3, 3) << fx, 0, cx, 0, fy, cy, 0, 0, 1);
    // OpenCV's order: k1, k2, p1, p2, k3.
    cv::Mat D = cv::Mat::zeros(1, 5, CV_64F);
    for (size_t i = 4; i < values.size(); ++i) D.at<double>(0, static_cast<int>(i - 4)) = values[i];

    // Keeping K as the new camera matrix preserves the image size and principal point.
    cv::Mat output;
    cv::undistort(image, output, K, D, K);

    if (!cv::imwrite(output_path, output)) {
        std::cerr << "Failed to write output image: " << output_path << "\n";
        return 3;
    }

    std::cout << output_path << "\n";
    return 0;
}
