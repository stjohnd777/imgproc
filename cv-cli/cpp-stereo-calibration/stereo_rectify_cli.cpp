#include <opencv2/calib3d.hpp>
#include <iostream>
#include "cli_args.hpp"
#include "calibration_json.hpp"

void writeMaps(const char* filename, const cv::Mat& mapX, const cv::Mat& mapY) {
    cv::FileStorage storage(filename, cv::FileStorage::WRITE | cv::FileStorage::FORMAT_JSON);
    if (!storage.isOpened()) throw std::runtime_error(std::string("Cannot write maps: ") + filename);
    storage << "map_x" << mapX << "map_y" << mapY;
    storage.release();
}

int dimension(const calibration::Json& doc, const char* name) {
    if (!doc.at(name).is_number_integer()) throw std::runtime_error(std::string(name) + " must be an integer.");
    const double value = doc.at(name).get<double>();
    if (value < 1 || value > 16384) throw std::runtime_error(std::string(name) + " must be between 1 and 16384.");
    return static_cast<int>(value);
}

int main(int argc, char* argv[]) {
    if (argc < 5 || argc > 6) {
        std::cerr << "Usage: stereo_rectify_cli calibration.json rectification.json leftMaps.json rightMaps.json [alpha=0]\n";
        return 1;
    }
    const double alpha = cli::doubleArg(argc, argv, 5, "alpha", 0, -1, 1);
    if (!std::isfinite(alpha)) cli::fail("alpha", "finite");
    try {
        std::ifstream input(argv[1]);
        if (!input) throw std::runtime_error("Cannot read calibration JSON.");
        calibration::Json doc;
        input >> doc;
        if (doc.at("schemaVersion") != 1 || doc.at("type") != "stereo_calibration" ||
            doc.at("lengthUnits") != "m" ||
            doc.at("transformConvention") != "point_C2 = R * point_C1 + T" ||
            doc.at("cameraAxes") != "x_right_y_down_z_forward")
            throw std::runtime_error("Unsupported calibration schema, units, or coordinate convention.");
        const cv::Size size(dimension(doc, "imageWidth"), dimension(doc, "imageHeight"));
        const cv::Mat K1 = calibration::readMatrix(doc, "K1", 3, 3);
        const cv::Mat K2 = calibration::readMatrix(doc, "K2", 3, 3);
        calibration::validateK(K1);
        calibration::validateK(K2);
        const cv::Mat D1 = calibration::readDistortion(doc, "D1"), D2 = calibration::readDistortion(doc, "D2");
        const cv::Mat R = calibration::readMatrix(doc, "R", 3, 3);
        const cv::Mat T = calibration::readMatrix(doc, "T", 3, 1);
        if (cv::norm(R.t() * R - cv::Mat::eye(3, 3, CV_64F)) > 1e-6 ||
            std::abs(cv::determinant(R) - 1) > 1e-6 || cv::norm(T) < 1e-9)
            throw std::runtime_error("R must be a proper rotation and T must define a nonzero baseline.");
        cv::Mat R1, R2, P1, P2, Q, map1X, map1Y, map2X, map2Y;
        cv::Rect roi1, roi2;
        cv::stereoRectify(K1, D1, K2, D2, size, R, T, R1, R2, P1, P2, Q,
            cv::CALIB_ZERO_DISPARITY, alpha, size, &roi1, &roi2);
        if (std::abs(P2.at<double>(1, 3)) > 1e-8 || P2.at<double>(0, 3) >= -1e-9)
            throw std::runtime_error("This workflow requires horizontal stereo with positive left-minus-right disparity; check camera order.");
        cv::initUndistortRectifyMap(K1, D1, R1, P1, size, CV_32FC1, map1X, map1Y);
        cv::initUndistortRectifyMap(K2, D2, R2, P2, size, CV_32FC1, map2X, map2Y);
        const auto roiJson = [](const cv::Rect& roi) {
            return calibration::Json{{"x", roi.x}, {"y", roi.y}, {"width", roi.width}, {"height", roi.height}};
        };
        calibration::Json output = {
            {"schemaVersion", 1}, {"type", "stereo_rectification"},
            {"imageWidth", size.width}, {"imageHeight", size.height}, {"lengthUnits", "m"},
            {"referenceFrame", "rectified_left_camera"}, {"cameraAxes", "x_right_y_down_z_forward"},
            {"disparityConvention", "u_left_minus_u_right"}, {"alpha", alpha},
            {"R1", calibration::matrixJson(R1)}, {"R2", calibration::matrixJson(R2)},
            {"P1", calibration::matrixJson(P1)}, {"P2", calibration::matrixJson(P2)},
            {"Q", calibration::matrixJson(Q)}, {"baselineM", cv::norm(T)},
            {"validRoiLeft", roiJson(roi1)}, {"validRoiRight", roiJson(roi2)}
        };
        writeMaps(argv[3], map1X, map1Y);
        writeMaps(argv[4], map2X, map2Y);
        calibration::writeJson(argv[2], output);
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "Stereo rectification failed: " << error.what() << '\n';
        return 2;
    }
}
