#include <iostream>
#include "filter_image.hpp"

struct Parameters {
    std::string input, output;
    double clip_limit;
    int tiles_x, tiles_y;
};

Parameters validate(int argc, char* argv[]) {
    if (argc < 3 || argc > 6) {
        throw std::invalid_argument(
            "Usage: clahe_cli <input> <output> [clip_limit=2] [tiles_x=8] [tiles_y=8]");
    }
    return {argv[1], argv[2],
        effects::number(argc, argv, 3, "clip_limit", 2, 1e-12),
        cli::intArg(argc, argv, 4, "tiles_x", 8, 1, 64),
        cli::intArg(argc, argv, 5, "tiles_y", 8, 1, 64)};
}

int main(int argc, char* argv[]) {
    try {
        const Parameters p = validate(argc, argv);
        const cv::Mat image = effects::read(p.input);
        if (image.depth() == CV_16U && image.channels() != 1) {
            throw std::invalid_argument("CLAHE supports 16-bit grayscale, but color input must be 8-bit");
        }
        if (p.tiles_x > image.cols || p.tiles_y > image.rows) {
            throw std::invalid_argument("Tile grid must not exceed the image dimensions");
        }
        const auto clahe = cv::createCLAHE(p.clip_limit, cv::Size(p.tiles_x, p.tiles_y));
        cv::Mat alpha, output;
        const cv::Mat color = effects::colorWithoutAlpha(image, alpha);
        if (color.channels() == 1) {
            clahe->apply(color, output);
        } else {
            cv::Mat lab;
            cv::cvtColor(color, lab, cv::COLOR_BGR2Lab);
            std::vector<cv::Mat> channels;
            cv::split(lab, channels);
            clahe->apply(channels[0], channels[0]);
            cv::merge(channels, lab);
            cv::cvtColor(lab, output, cv::COLOR_Lab2BGR);
        }
        effects::write(p.output, effects::restoreAlpha(output, alpha));
        std::cout << p.output << "\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
