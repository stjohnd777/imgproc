#include <iostream>
#include "filter_image.hpp"

struct Parameters {
    std::string input, output;
    int diameter;
    double sigma_color, sigma_space;
};

Parameters validate(int argc, char* argv[]) {
    if (argc < 3 || argc > 6) {
        throw std::invalid_argument(
            "Usage: bilateral_cli <input> <output> [diameter=9] "
            "[sigma_color=25] [sigma_space=5]");
    }
    return {argv[1], argv[2],
        cli::oddIntArg(argc, argv, 3, "diameter", 9, 1, 31),
        effects::number(argc, argv, 4, "sigma_color", 25, 1e-12),
        effects::number(argc, argv, 5, "sigma_space", 5, 1e-12)};
}

int main(int argc, char* argv[]) {
    try {
        const Parameters p = validate(argc, argv);
        const cv::Mat image = effects::read(p.input);
        cv::Mat alpha;
        const cv::Mat color = effects::colorWithoutAlpha(image, alpha);
        cv::Mat source = color, filtered, output;
        const bool sixteenBit = image.depth() == CV_16U;
        if (sixteenBit) color.convertTo(source, CV_32F);
        cv::bilateralFilter(source, filtered, p.diameter,
            p.sigma_color * (sixteenBit ? 257 : 1), p.sigma_space,
            cv::BORDER_REFLECT_101);
        filtered.convertTo(output, color.type());
        effects::write(p.output, effects::restoreAlpha(output, alpha));
        std::cout << p.output << "\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
