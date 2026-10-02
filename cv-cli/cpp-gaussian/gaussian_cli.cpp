#include <iostream>
#include <string>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: gaussian_cli <input_image> <output_image> [ksize] [sigmaX] [sigmaY]\n";
        return 1;
    }

    const std::string input_path = argv[1];
    const std::string output_path = argv[2];

    int ksize = 5;
    double sigma_x = 0.0;
    double sigma_y = 0.0;
    try {
        if (argc > 3) ksize = std::stoi(argv[3]);
        if (argc > 4) sigma_x = std::stod(argv[4]);
        if (argc > 5) sigma_y = std::stod(argv[5]);
    } catch (const std::exception&) {
        std::cerr << "ksize, sigmaX and sigmaY must be numbers\n";
        return 1;
    }

    if (ksize < 1 || ksize > 31 || ksize % 2 == 0) {
        std::cerr << "ksize must be an odd number between 1 and 31\n";
        return 1;
    }
    if (sigma_x < 0.0 || sigma_y < 0.0) {
        std::cerr << "sigmaX and sigmaY must be zero or greater\n";
        return 1;
    }

    const cv::Mat image = cv::imread(input_path, cv::IMREAD_COLOR);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << input_path << "\n";
        return 2;
    }

    // OpenCV derives a sigma from the kernel size when it is passed as zero.
    cv::Mat output;
    cv::GaussianBlur(image, output, cv::Size(ksize, ksize), sigma_x, sigma_y);

    if (!cv::imwrite(output_path, output)) {
        std::cerr << "Failed to write output image: " << output_path << "\n";
        return 3;
    }

    std::cout << output_path << "\n";
    return 0;
}
