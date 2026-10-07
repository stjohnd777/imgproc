#include <iostream>
#include <map>
#include "filter_image.hpp"

struct Parameters {
    std::string input, output;
    int operation, shape, kernel_size, iterations;
};

Parameters validate(int argc, char* argv[]) {
    if (argc < 3 || argc > 7) {
        throw std::invalid_argument(
            "Usage: morphology_cli <input> <output> [operation=open] "
            "[shape=ellipse] [kernel_size=3] [iterations=1]");
    }
    const std::map<std::string, int> operations{
        {"erode", cv::MORPH_ERODE}, {"dilate", cv::MORPH_DILATE},
        {"open", cv::MORPH_OPEN}, {"close", cv::MORPH_CLOSE},
        {"gradient", cv::MORPH_GRADIENT}};
    const std::map<std::string, int> shapes{
        {"rectangle", cv::MORPH_RECT}, {"ellipse", cv::MORPH_ELLIPSE},
        {"cross", cv::MORPH_CROSS}};
    const std::string operation = argc > 3 && *argv[3] ? argv[3] : "open";
    const std::string shape = argc > 4 && *argv[4] ? argv[4] : "ellipse";
    if (!operations.count(operation)) throw std::invalid_argument("Unknown morphology operation: " + operation);
    if (!shapes.count(shape)) throw std::invalid_argument("Unknown kernel shape: " + shape);
    return {argv[1], argv[2], operations.at(operation), shapes.at(shape),
        cli::oddIntArg(argc, argv, 5, "kernel_size", 3, 1, 63),
        cli::intArg(argc, argv, 6, "iterations", 1, 1, 20)};
}

int main(int argc, char* argv[]) {
    try {
        const Parameters p = validate(argc, argv);
        const cv::Mat image = effects::read(p.input);
        cv::Mat alpha, output;
        const cv::Mat color = effects::colorWithoutAlpha(image, alpha);
        const cv::Mat kernel = cv::getStructuringElement(p.shape, cv::Size(p.kernel_size, p.kernel_size));
        cv::morphologyEx(color, output, p.operation, kernel, cv::Point(-1, -1),
            p.iterations, cv::BORDER_CONSTANT, cv::morphologyDefaultBorderValue());
        effects::write(p.output, effects::restoreAlpha(output, alpha));
        std::cout << p.output << "\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
