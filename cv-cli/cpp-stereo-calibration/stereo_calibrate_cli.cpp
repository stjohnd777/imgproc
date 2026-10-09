#include <opencv2/calib3d.hpp>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <filesystem>
#include <map>
#include <set>
#include <algorithm>
#include <cctype>
#include <iostream>
#include "cli_args.hpp"
#include "calibration_json.hpp"

namespace fs = std::filesystem;
using calibration::Json;

std::map<std::string, fs::path> images(const char* folder) {
    if (!fs::is_directory(folder)) throw std::runtime_error(std::string("Not an image folder: ") + folder);
    const std::set<std::string> extensions = {".png", ".jpg", ".jpeg", ".bmp", ".pgm", ".ppm", ".tif", ".tiff"};
    std::map<std::string, fs::path> result;
    for (const auto& entry : fs::directory_iterator(folder)) {
        if (entry.is_symlink()) throw std::runtime_error("Calibration folders must not contain symlinks.");
        if (!entry.is_regular_file()) continue;
        std::string extension = entry.path().extension().string();
        std::transform(extension.begin(), extension.end(), extension.begin(),
                       [](unsigned char value) { return static_cast<char>(std::tolower(value)); });
        if (extensions.count(extension)) result.emplace(entry.path().filename().string(), entry.path());
    }
    if (result.empty()) throw std::runtime_error(std::string("No supported images in: ") + folder);
    return result;
}

cv::Mat grayImage(const fs::path& filename) {
    const cv::Mat image = cv::imread(filename.string(), cv::IMREAD_UNCHANGED);
    if (image.empty()) throw std::runtime_error("Cannot read calibration image: " + filename.string());
    if (image.depth() != CV_8U) throw std::runtime_error("Calibration images must be 8-bit.");
    cv::Mat gray;
    if (image.channels() == 1) gray = image;
    else if (image.channels() == 3) cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);
    else if (image.channels() == 4) cv::cvtColor(image, gray, cv::COLOR_BGRA2GRAY);
    else throw std::runtime_error("Unsupported calibration image channels.");
    return gray;
}

int main(int argc, char* argv[]) {
    if (argc < 4 || argc > 8) {
        std::cerr << "Usage: stereo_calibrate_cli leftDir rightDir calibration.json "
                     "[columns=9] [rows=6] [squareSizeM=0.025] [minPairs=8]\n";
        return 1;
    }
    const cv::Size board(cli::intArg(argc, argv, 4, "columns", 9, 3, 30),
                         cli::intArg(argc, argv, 5, "rows", 6, 3, 30));
    const double square = cli::doubleArg(argc, argv, 6, "squareSizeM", 0.025, 0.000001, 10);
    const int minimum = cli::intArg(argc, argv, 7, "minPairs", 8, 3, 1000);
    if (!std::isfinite(square)) cli::fail("squareSizeM", "finite");
    try {
        const auto leftFiles = images(argv[1]), rightFiles = images(argv[2]);
        if (fs::equivalent(argv[1], argv[2])) throw std::runtime_error("Left and right folders must be different.");
        if (leftFiles.size() != rightFiles.size()) throw std::runtime_error("Image folders have unmatched filenames.");
        for (const auto& [name, filename] : rightFiles)
            if (!leftFiles.count(name)) throw std::runtime_error("Unmatched right image: " + name);
        std::vector<cv::Point3f> boardPoints;
        for (int row = 0; row < board.height; ++row)
            for (int col = 0; col < board.width; ++col)
                boardPoints.emplace_back(col * square, row * square, 0);
        std::vector<std::vector<cv::Point3f>> objectPoints;
        std::vector<std::vector<cv::Point2f>> leftPoints, rightPoints;
        Json accepted = Json::array(), rejected = Json::array();
        cv::Size size;
        for (const auto& [name, filename] : leftFiles) {
            const cv::Mat left = grayImage(filename), right = grayImage(rightFiles.at(name));
            if (size.empty()) size = left.size();
            if (left.size() != size || right.size() != size)
                throw std::runtime_error("All calibration images must have identical dimensions.");
            std::vector<cv::Point2f> cornersL, cornersR;
            const bool foundL = cv::findChessboardCornersSB(left, board, cornersL);
            const bool foundR = cv::findChessboardCornersSB(right, board, cornersR);
            if (!foundL || !foundR) {
                rejected.push_back({{"file", name}, {"reason", "Checkerboard not detected in both images"}});
                std::cerr << "Rejected pair " << name << ": checkerboard not detected in both images.\n";
                continue;
            }
            objectPoints.push_back(boardPoints);
            leftPoints.push_back(cornersL);
            rightPoints.push_back(cornersR);
            accepted.push_back(name);
        }
        if (objectPoints.size() < static_cast<std::size_t>(minimum))
            throw std::runtime_error("Insufficient accepted checkerboard pairs: " + std::to_string(objectPoints.size()));
        cv::Mat K1, K2, D1, D2, R, T, E, F;
        std::vector<cv::Mat> rvecs, tvecs;
        const double rmsL = cv::calibrateCamera(objectPoints, leftPoints, size, K1, D1, rvecs, tvecs);
        const double rmsR = cv::calibrateCamera(objectPoints, rightPoints, size, K2, D2, rvecs, tvecs);
        const double rmsStereo = cv::stereoCalibrate(objectPoints, leftPoints, rightPoints,
            K1, D1, K2, D2, size, R, T, E, F, cv::CALIB_FIX_INTRINSIC);
        calibration::validateK(K1);
        calibration::validateK(K2);
        if (!std::isfinite(rmsL) || !std::isfinite(rmsR) || !std::isfinite(rmsStereo) ||
            !std::isfinite(cv::norm(T)) || cv::norm(T) < 1e-9)
            throw std::runtime_error("Calibration is degenerate or non-finite.");
        calibration::writeJson(argv[3], {
            {"schemaVersion", 1}, {"type", "stereo_calibration"},
            {"imageWidth", size.width}, {"imageHeight", size.height}, {"lengthUnits", "m"},
            {"transformConvention", "point_C2 = R * point_C1 + T"},
            {"cameraAxes", "x_right_y_down_z_forward"},
            {"K1", calibration::matrixJson(K1)}, {"K2", calibration::matrixJson(K2)},
            {"D1", calibration::matrixJson(D1.reshape(1, 1))[0]},
            {"D2", calibration::matrixJson(D2.reshape(1, 1))[0]},
            {"R", calibration::matrixJson(R)}, {"T", calibration::matrixJson(T)},
            {"baselineM", cv::norm(T)}, {"acceptedPairs", accepted}, {"rejectedPairs", rejected},
            {"checkerboard", {{"columns", board.width}, {"rows", board.height}, {"squareSizeM", square}}},
            {"rmsPixels", {{"left", rmsL}, {"right", rmsR}, {"stereo", rmsStereo}}}
        });
        std::cout << "Accepted " << accepted.size() << " pairs; stereo RMS " << rmsStereo << " px.\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "Stereo calibration failed: " << error.what() << '\n';
        return 2;
    }
}
