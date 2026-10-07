#include <algorithm>
#include <cstdint>
#include <iostream>
#include <random>
#include "image_io.hpp"

struct Parameters {
    std::string input, output;
    double sigma;
    int seed, frame_index;
};

Parameters validate(int argc, char* argv[]) {
    if (argc < 3 || argc > 6) {
        throw std::invalid_argument(
            "Usage: add_noise_cli <input> <output> [sigma=5] [seed=0] [frame_index=0]");
    }
    return {argv[1], argv[2],
        effects::number(argc, argv, 3, "sigma", 5, 0),
        cli::intArg(argc, argv, 4, "seed", 0, 0),
        cli::intArg(argc, argv, 5, "frame_index", 0, 0)};
}

template<class Pixel>
void addNoise(cv::Mat& image, const Parameters& p, double maximum) {
    if (p.sigma == 0) return;
    std::seed_seq seeds{static_cast<std::uint32_t>(p.seed),
                        static_cast<std::uint32_t>(p.frame_index)};
    std::mt19937_64 rng(seeds);
    std::normal_distribution<double> normal(0, 1);
    const int channels = image.channels();
    const int colorChannels = channels == 4 ? 3 : channels;
    for (int y = 0; y < image.rows; ++y) {
        Pixel* row = image.ptr<Pixel>(y);
        for (int x = 0; x < image.cols; ++x) {
            for (int c = 0; c < colorChannels; ++c) {
                Pixel& value = row[x * channels + c];
                // Sigma is in 8-bit-equivalent levels, including for 16-bit input.
                const double noisy = value + normal(rng) * p.sigma * (maximum / 255);
                value = static_cast<Pixel>(std::round(std::clamp(noisy, 0.0, maximum)));
            }
        }
    }
}

int main(int argc, char* argv[]) {
    try {
        const Parameters p = validate(argc, argv);
        cv::Mat image = effects::read(p.input);
        if (image.depth() == CV_8U) addNoise<std::uint8_t>(image, p, 255);
        else addNoise<std::uint16_t>(image, p, 65535);
        effects::write(p.output, image);
        std::cout << p.output << "\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
