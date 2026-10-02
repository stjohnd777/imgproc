#include <iostream>
#include <string>
#include <filesystem>
#include <opencv2/core.hpp>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include "cli_args.hpp"

namespace fs = std::filesystem;

namespace {

int parseInterpolation(const std::string& mode) {
    if (mode == "linear" || mode == "1" || mode.empty()) return cv::INTER_LINEAR;
    if (mode == "nearest" || mode == "0") return cv::INTER_NEAREST;
    if (mode == "cubic" || mode == "2") return cv::INTER_CUBIC;
    if (mode == "lanczos4" || mode == "4") return cv::INTER_LANCZOS4;
    return -1;
}

int parseBorderMode(const std::string& mode) {
    if (mode == "constant" || mode == "0" || mode.empty()) return cv::BORDER_CONSTANT;
    if (mode == "replicate" || mode == "1") return cv::BORDER_REPLICATE;
    if (mode == "reflect" || mode == "2") return cv::BORDER_REFLECT;
    if (mode == "reflect101" || mode == "4") return cv::BORDER_REFLECT_101;
    if (mode == "wrap" || mode == "3") return cv::BORDER_WRAP;
    return -1;
}

void generatePresetMap(const std::string& preset, const cv::Size& size, cv::Mat& mapX, cv::Mat& mapY) {
    mapX.create(size, CV_32FC1);
    mapY.create(size, CV_32FC1);

    for (int y = 0; y < size.height; ++y) {
        for (int x = 0; x < size.width; ++x) {
            if (preset == "flip_h") {
                mapX.at<float>(y, x) = static_cast<float>(size.width - 1 - x);
                mapY.at<float>(y, x) = static_cast<float>(y);
            } else if (preset == "flip_v") {
                mapX.at<float>(y, x) = static_cast<float>(x);
                mapY.at<float>(y, x) = static_cast<float>(size.height - 1 - y);
            } else if (preset == "flip_hv") {
                mapX.at<float>(y, x) = static_cast<float>(size.width - 1 - x);
                mapY.at<float>(y, x) = static_cast<float>(size.height - 1 - y);
            } else {
                // Identity mapping (default)
                mapX.at<float>(y, x) = static_cast<float>(x);
                mapY.at<float>(y, x) = static_cast<float>(y);
            }
        }
    }
}

bool tryLoadFileStorage(const std::string& path, cv::Mat& outX, cv::Mat& outY) {
    try {
        cv::FileStorage fs(path, cv::FileStorage::READ);
        if (!fs.isOpened()) return false;

        auto extract = [&fs](const std::vector<std::string>& keys, cv::Mat& mat) {
            for (const auto& k : keys) {
                if (!fs[k].empty()) {
                    fs[k] >> mat;
                    if (!mat.empty()) return true;
                }
            }
            return false;
        };

        if (outX.empty()) extract({"map_x", "map1", "mx", "x"}, outX);
        if (outY.empty()) extract({"map_y", "map2", "my", "y"}, outY);

        return !outX.empty();
    } catch (...) {
        return false;
    }
}

} // namespace

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: remap_cli <input_image> <output_image> [map_x] [map_y] [interpolation] [border_mode]\n";
        return 1;
    }

    const std::string input_path = argv[1];
    const std::string output_path = argv[2];
    const std::string map_x_arg = argc > 3 ? argv[3] : "identity";
    const std::string map_y_arg = argc > 4 ? argv[4] : "";
    const std::string interp_arg = argc > 5 ? argv[5] : "linear";
    const std::string border_arg = argc > 6 ? argv[6] : "constant";

    const int interp = parseInterpolation(interp_arg);
    if (interp < 0) {
        std::cerr << "Invalid interpolation mode: " << interp_arg << " (expected linear, nearest, cubic, lanczos4)\n";
        return 1;
    }

    const int border = parseBorderMode(border_arg);
    if (border < 0) {
        std::cerr << "Invalid border mode: " << border_arg << " (expected constant, replicate, reflect, reflect101, wrap)\n";
        return 1;
    }

    const cv::Mat image = cv::imread(input_path, cv::IMREAD_UNCHANGED);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << input_path << "\n";
        return 2;
    }

    cv::Mat mapX;
    cv::Mat mapY;

    if (map_x_arg.empty() || map_x_arg == "identity" || map_x_arg == "flip_h" ||
        map_x_arg == "flip_v" || map_x_arg == "flip_hv") {
        generatePresetMap(map_x_arg, image.size(), mapX, mapY);
    } else {
        if (!fs::exists(map_x_arg)) {
            std::cerr << "Map X file not found: " << map_x_arg << "\n";
            return 2;
        }

        // Try FileStorage first (.xml / .yml / .yaml)
        tryLoadFileStorage(map_x_arg, mapX, mapY);

        // If not loaded from XML/YAML, try loading as an image (EXR, TIFF, PNG)
        if (mapX.empty()) {
            mapX = cv::imread(map_x_arg, cv::IMREAD_UNCHANGED);
        }

        if (mapX.empty()) {
            std::cerr << "Failed to parse or load Map X from " << map_x_arg << "\n";
            return 2;
        }

        // If mapY was not present in mapX file, try loading from map_y_arg
        if (mapY.empty() && !map_y_arg.empty() && map_y_arg != "none") {
            if (!fs::exists(map_y_arg)) {
                std::cerr << "Map Y file not found: " << map_y_arg << "\n";
                return 2;
            }
            tryLoadFileStorage(map_y_arg, mapX, mapY);
            if (mapY.empty()) {
                mapY = cv::imread(map_y_arg, cv::IMREAD_UNCHANGED);
            }
            if (mapY.empty()) {
                std::cerr << "Failed to parse or load Map Y from " << map_y_arg << "\n";
                return 2;
            }
        }

        // If mapX is single-channel, mapY must be provided
        if (mapX.channels() == 1 && mapY.empty()) {
            std::cerr << "Map X is single-channel but Map Y was not found in " << map_x_arg
                      << " or " << map_y_arg << "\n";
            return 2;
        }
    }

    cv::Mat output;
    cv::remap(image, output, mapX, mapY, interp, border, cv::Scalar(0, 0, 0));

    if (!cv::imwrite(output_path, output)) {
        std::cerr << "Failed to write output image: " << output_path << "\n";
        return 3;
    }

    std::cout << output_path << "\n";
    return 0;
}
