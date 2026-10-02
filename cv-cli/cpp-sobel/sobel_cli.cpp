#include <iostream>
#include <string>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include "cli_args.hpp"

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: sobel_cli <input_image> <output_image> [x|y|xy] [ksize]\n";
        return 1;
    }

    const std::string input_path = argv[1];
    const std::string output_path = argv[2];
    const std::string mode = argc > 3 && std::string(argv[3]).size() > 0 ? argv[3] : "xy";
    if (mode != "x" && mode != "y" && mode != "xy") {
        std::cerr << "Invalid mode '" << mode << "': expected x, y, or xy\n";
        return 1;
    }
    const int ksize = cli::oddIntArg(argc, argv, 4, "ksize", 3, 1, 7);

    cv::Mat image = cv::imread(input_path, cv::IMREAD_COLOR);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << input_path << "\n";
        return 2;
    }

    cv::Mat gray;
    cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);

    cv::Mat grad_x, grad_y, grad;
    cv::Sobel(gray, grad_x, CV_16S, 1, 0, ksize, 1, 0, cv::BORDER_DEFAULT);
    cv::Sobel(gray, grad_y, CV_16S, 0, 1, ksize, 1, 0, cv::BORDER_DEFAULT);

    cv::Mat abs_grad_x, abs_grad_y;
    cv::convertScaleAbs(grad_x, abs_grad_x);
    cv::convertScaleAbs(grad_y, abs_grad_y);

    if (mode == "x") {
        grad = abs_grad_x;
    } else if (mode == "y") {
        grad = abs_grad_y;
    } else {
        cv::addWeighted(abs_grad_x, 0.5, abs_grad_y, 0.5, 0.0, grad);
    }

    if (!cv::imwrite(output_path, grad)) {
        std::cerr << "Failed to write output image: " << output_path << "\n";
        return 3;
    }

    std::cout << output_path << "\n";
    return 0;
}