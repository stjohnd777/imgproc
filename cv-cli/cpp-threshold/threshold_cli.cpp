#include <algorithm>
#include <iostream>
#include <string>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

int main(int argc, char* argv[]) {
    if (argc < 5) {
        std::cerr << "Usage: threshold_cli <input_image> <output_image> <low> <high> [set_band_value] [value]\n";
        return 1;
    }

    const std::string inputPath = argv[1];
    const std::string outputPath = argv[2];
    const int low = std::stoi(argv[3]);
    const int high = std::stoi(argv[4]);
    const bool setBandValue = argc > 5 && std::stoi(argv[5]) != 0;
    const int bandValue = argc > 6 ? std::stoi(argv[6]) : 255;

    if (low < 0 || high > 255 || low > high || bandValue < 0 || bandValue > 255) {
        std::cerr << "Range and band value must be in 0..255, with low <= high\n";
        return 1;
    }

    const cv::Mat image = cv::imread(inputPath, cv::IMREAD_COLOR);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << inputPath << "\n";
        return 2;
    }

    cv::Mat gray;
    cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);

    cv::Mat mask;
    cv::inRange(gray, cv::Scalar(low), cv::Scalar(high), mask);

    cv::Mat output = cv::Mat::zeros(image.size(), image.type());
    image.copyTo(output, mask);

    if (setBandValue) {
        output.setTo(cv::Scalar(bandValue, bandValue, bandValue), mask);
    }

    if (!cv::imwrite(outputPath, output)) {
        std::cerr << "Failed to write output image: " << outputPath << "\n";
        return 3;
    }

    std::cout << outputPath << "\n";
    return 0;
}
