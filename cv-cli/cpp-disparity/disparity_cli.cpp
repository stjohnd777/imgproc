#include <opencv2/calib3d.hpp>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <nlohmann/json.hpp>
#include <fstream>
#include <iostream>
#include "cli_args.hpp"

cv::Mat readGray(const char* filename) {
    cv::Mat image = cv::imread(filename, cv::IMREAD_UNCHANGED);
    if (image.empty()) throw std::runtime_error(std::string("Cannot read image: ") + filename);
    if (image.depth() != CV_8U) throw std::runtime_error("StereoSGBM inputs must be 8-bit images.");
    cv::Mat gray;
    if (image.channels() == 1) gray = image;
    else if (image.channels() == 3) cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);
    else if (image.channels() == 4) cv::cvtColor(image, gray, cv::COLOR_BGRA2GRAY);
    else throw std::runtime_error("Inputs must be grayscale, BGR, or BGRA.");
    return gray;
}

int main(int argc, char* argv[]) {
    if (argc < 5 || argc > 10) {
        std::cerr << "Usage: disparity_cli left right preview.png data.json "
                     "[numDisparities=64] [blockSize=9] [uniquenessRatio=10] "
                     "[speckleWindowSize=100] [speckleRange=2]\n";
        return 1;
    }
    const int range = cli::intArg(argc, argv, 5, "numDisparities", 64, 16, 512);
    if (range % 16 != 0) cli::fail("numDisparities", "a multiple of 16");
    const int block = cli::oddIntArg(argc, argv, 6, "blockSize", 9, 3, 21);
    const int uniqueness = cli::intArg(argc, argv, 7, "uniquenessRatio", 10, 0, 100);
    const int speckleWindow = cli::intArg(argc, argv, 8, "speckleWindowSize", 100, 0, 1000);
    const int speckleRange = cli::intArg(argc, argv, 9, "speckleRange", 2, 0, 32);
    try {
        const cv::Mat left = readGray(argv[1]), right = readGray(argv[2]);
        if (left.size() != right.size()) throw std::runtime_error("Left/right image dimensions must match.");
        if (left.cols <= range + block / 2 || left.rows < block)
            throw std::runtime_error("Image is too small for the disparity range and block size; reduce these settings.");
        const auto matcher = cv::StereoSGBM::create(
            0, range, block, 8 * block * block, 32 * block * block,
            1, 31, uniqueness, speckleWindow, speckleRange, cv::StereoSGBM::MODE_SGBM);
        cv::Mat fixed;
        matcher->compute(left, right, fixed);
        cv::Mat preview(left.size(), CV_8UC1, cv::Scalar(0));
        nlohmann::json values = nlohmann::json::array();
        std::size_t validCount = 0;
        for (int y = 0; y < fixed.rows; ++y) {
            for (int x = 0; x < fixed.cols; ++x) {
                const short raw = fixed.at<short>(y, x);
                if (raw < 0) values.push_back(nullptr);
                else {
                    const double disparity = raw / 16.0;
                    values.push_back(disparity);
                    preview.at<unsigned char>(y, x) = cv::saturate_cast<unsigned char>(disparity * 255.0 / range);
                    ++validCount;
                }
            }
        }
        const nlohmann::json doc = {
            {"schemaVersion", 1}, {"type", "disparity"}, {"algorithm", "StereoSGBM"},
            {"width", left.cols}, {"height", left.rows}, {"units", "pixels"},
            {"layout", "row-major"}, {"invalidValue", nullptr}, {"validCount", validCount},
            {"parameters", {{"numDisparities", range}, {"blockSize", block},
                            {"uniquenessRatio", uniqueness}, {"speckleWindowSize", speckleWindow},
                            {"speckleRange", speckleRange}}},
            {"disparities", values}
        };
        if (!cv::imwrite(argv[3], preview)) throw std::runtime_error("Cannot write disparity preview.");
        std::ofstream output;
        output.exceptions(std::ios::failbit | std::ios::badbit);
        output.open(argv[4]);
        output << doc.dump() << '\n';
        output.close();
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "Disparity failed: " << error.what() << '\n';
        return 2;
    }
}
