#include <iostream>
#include <opencv2/core.hpp>
#include "image_io.hpp"

int main(int argc, char* argv[]) {
    try {
#ifdef CONCAT_HORIZONTAL
        constexpr bool horizontal = true;
        const std::string name = "hconcat";
#else
        constexpr bool horizontal = false;
        const std::string name = "vconcat";
#endif
        if (argc != 4) {
            throw std::invalid_argument("Usage: " + name + "_cli <img0> <img1> <output>");
        }
        const cv::Mat img0 = effects::read(argv[1]);
        const cv::Mat img1 = effects::read(argv[2]);
        if (img0.type() != img1.type()) {
            throw std::invalid_argument(name + " requires matching bit depth and channel count");
        }
        if (horizontal && img0.rows != img1.rows) {
            throw std::invalid_argument("hconcat requires matching image heights");
        }
        if (!horizontal && img0.cols != img1.cols) {
            throw std::invalid_argument("vconcat requires matching image widths");
        }
        cv::Mat output;
        if (horizontal) cv::hconcat(img0, img1, output);
        else cv::vconcat(img0, img1, output);
        effects::write(argv[3], output);
        std::cout << argv[3] << "\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
