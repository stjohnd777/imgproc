#include <iostream>
#include <string>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: median_cli <input_image> <output_image> [ksize]\n";
        return 1;
    }

    const std::string input_path = argv[1];
    const std::string output_path = argv[2];
    const int ksize = argc > 3 ? std::stoi(argv[3]) : 5;
    if (ksize < 3 || ksize > 31 || ksize % 2 == 0) {
        std::cerr << "ksize must be an odd number between 3 and 31\n";
        return 1;
    }

    const cv::Mat image = cv::imread(input_path, cv::IMREAD_COLOR);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << input_path << "\n";
        return 2;
    }

    cv::Mat output;
    cv::medianBlur(image, output, ksize);

    if (!cv::imwrite(output_path, output)) {
        std::cerr << "Failed to write output image: " << output_path << "\n";
        return 3;
    }

    std::cout << output_path << "\n";
    return 0;
}
