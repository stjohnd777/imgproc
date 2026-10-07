#include <iostream>
#include "filter_image.hpp"

int main(int argc, char* argv[]) {
    try {
        if (argc != 4) {
            throw std::invalid_argument("Usage: image_diff_cli <img0> <img1> <output>");
        }
        const cv::Mat img0 = effects::read(argv[1]);
        const cv::Mat img1 = effects::read(argv[2]);
        if (img0.size() != img1.size()) {
            throw std::invalid_argument("Image Diff requires matching image dimensions");
        }
        if (img0.type() != img1.type()) {
            throw std::invalid_argument("Image Diff requires matching bit depth and channel count");
        }
        cv::Mat alpha0, alpha1, output;
        const cv::Mat color0 = effects::colorWithoutAlpha(img0, alpha0);
        const cv::Mat color1 = effects::colorWithoutAlpha(img1, alpha1);
        cv::absdiff(color0, color1, output);
        // A differenced alpha would hide identical-alpha pixels in the viewer.
        if (!alpha0.empty()) alpha0.setTo(img0.depth() == CV_16U ? 65535 : 255);
        effects::write(argv[3], effects::restoreAlpha(output, alpha0));
        std::cout << argv[3] << "\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
