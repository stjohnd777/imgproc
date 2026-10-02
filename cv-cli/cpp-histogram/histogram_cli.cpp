#include <algorithm>
#include <iostream>
#include <string>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include "cli_args.hpp"

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: histogram_cli <input_image> <output_image> [bins]\n";
        return 1;
    }

    const std::string inputPath = argv[1];
    const std::string outputPath = argv[2];
    const int histogramSize = cli::intArg(argc, argv, 3, "bins", 256, 2, 256);
    const cv::Mat image = cv::imread(inputPath, cv::IMREAD_GRAYSCALE);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << inputPath << "\n";
        return 2;
    }

    const float range[] = { 0, 256 };
    const float* histogramRange = { range };
    cv::Mat histogram;
    cv::calcHist(&image, 1, nullptr, cv::Mat(), histogram, 1, &histogramSize, &histogramRange);

    const int width = 768;
    const int height = 420;
    const int baseline = height - 35;
    cv::Mat output(height, width, CV_8UC3, cv::Scalar(24, 24, 24));
    const double maxValue = *std::max_element(histogram.begin<float>(), histogram.end<float>());

    for (int i = 0; i < histogramSize; ++i) {
        const int x = i * width / histogramSize;
        const int nextX = (i + 1) * width / histogramSize;
        const int barHeight = maxValue > 0 ? static_cast<int>(histogram.at<float>(i) / maxValue * (height - 55)) : 0;
        cv::rectangle(output, cv::Point(x, baseline - barHeight), cv::Point(std::max(x + 1, nextX - 1), baseline),
                      cv::Scalar(210, 210, 210), cv::FILLED);
    }

    cv::line(output, cv::Point(0, baseline), cv::Point(width, baseline), cv::Scalar(120, 120, 120), 1);
    cv::putText(output, "0", cv::Point(5, height - 10), cv::FONT_HERSHEY_SIMPLEX, 0.45, cv::Scalar(180, 180, 180), 1);
    cv::putText(output, "255", cv::Point(width - 35, height - 10), cv::FONT_HERSHEY_SIMPLEX, 0.45, cv::Scalar(180, 180, 180), 1);
    cv::putText(output, "Grayscale histogram", cv::Point(12, 24), cv::FONT_HERSHEY_SIMPLEX, 0.65, cv::Scalar(230, 230, 230), 1);

    if (!cv::imwrite(outputPath, output)) {
        std::cerr << "Failed to write output image: " << outputPath << "\n";
        return 3;
    }

    std::cout << outputPath << "\n";
    return 0;
}
