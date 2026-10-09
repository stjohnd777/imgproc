#include <opencv2/imgcodecs.hpp>
#include <algorithm>
#include <iomanip>
#include <iostream>
#include <vector>
#include "cli_args.hpp"
#include "../cpp-stereo-calibration/calibration_json.hpp"

using calibration::Json;

Json readJson(const char* filename) {
    std::ifstream input(filename);
    if (!input) throw std::runtime_error(std::string("Cannot read JSON: ") + filename);
    Json doc;
    input >> doc;
    return doc;
}

int dimension(const Json& doc, const char* name) {
    const auto& value = doc.at(name);
    if (!value.is_number_integer() || value.get<double>() < 1 || value.get<double>() > 16384)
        throw std::runtime_error(std::string(name) + " must be an integer between 1 and 16384.");
    return value.get<int>();
}

cv::Rect validRoi(const Json& doc, const char* name, int width, int height) {
    if (!doc.contains(name)) return {0, 0, width, height};
    const auto& roi = doc.at(name);
    for (const char* field : {"x", "y", "width", "height"}) {
        if (!roi.at(field).is_number_integer() || roi.at(field).get<double>() < 0 ||
            roi.at(field).get<double>() > 16384)
            throw std::runtime_error(std::string(name) + " must contain nonnegative integer bounds.");
    }
    const cv::Rect bounds(roi.at("x").get<int>(), roi.at("y").get<int>(),
                          roi.at("width").get<int>(), roi.at("height").get<int>());
    if (bounds.x + bounds.width > width || bounds.y + bounds.height > height)
        throw std::runtime_error(std::string(name) + " extends beyond the calibrated image.");
    return bounds;
}

bool inside(const cv::Rect& roi, double x, double y) {
    return x >= roi.x && x < roi.x + roi.width && y >= roi.y && y < roi.y + roi.height;
}

int main(int argc, char* argv[]) {
    if (argc < 5 || argc > 9) {
        std::cerr << "Usage: dense_stereo_cli disparity.json rectification.json position.json points.ply "
                     "[minDisparity=0.01] [maxRangeM=10000] [minPoints=10] [mask]\n";
        return 1;
    }
    const double minimum = cli::doubleArg(argc, argv, 5, "minDisparity", 0.01, 0, 512);
    const double maximum = cli::doubleArg(argc, argv, 6, "maxRangeM", 10000, 0.000001, 1e9);
    const int minPoints = cli::intArg(argc, argv, 7, "minPoints", 10, 1, 100000000);
    if (!std::isfinite(minimum) || !std::isfinite(maximum)) cli::fail("range/disparity limits", "finite");
    try {
        const Json disparity = readJson(argv[1]), rectification = readJson(argv[2]);
        if (disparity.at("schemaVersion") != 1 || disparity.at("type") != "disparity" ||
            disparity.at("units") != "pixels" || disparity.at("layout") != "row-major" ||
            !disparity.at("invalidValue").is_null())
            throw std::runtime_error("Expected numeric Disparity data JSON in pixels, not a preview image.");
        if (rectification.at("schemaVersion") != 1 || rectification.at("type") != "stereo_rectification" ||
            rectification.at("lengthUnits") != "m" || rectification.at("referenceFrame") != "rectified_left_camera" ||
            rectification.at("cameraAxes") != "x_right_y_down_z_forward" ||
            rectification.at("disparityConvention") != "u_left_minus_u_right")
            throw std::runtime_error("Unsupported rectification schema, units, frame, or disparity convention.");
        const int width = dimension(disparity, "width"), height = dimension(disparity, "height");
        if (width != dimension(rectification, "imageWidth") || height != dimension(rectification, "imageHeight"))
            throw std::runtime_error("Disparity and rectification dimensions must match.");
        const auto& values = disparity.at("disparities");
        const std::size_t total = static_cast<std::size_t>(width) * height;
        if (!values.is_array() || values.size() != total) throw std::runtime_error("Disparity array size does not match dimensions.");
        const cv::Mat Q = calibration::readMatrix(rectification, "Q", 4, 4);
        if (std::abs(cv::determinant(Q)) < 1e-12 || Q.at<double>(2, 3) <= 0 || Q.at<double>(3, 2) <= 0)
            throw std::runtime_error("Q must be a nondegenerate positive-disparity horizontal reconstruction matrix.");
        const cv::Rect roiL = validRoi(rectification, "validRoiLeft", width, height);
        const cv::Rect roiR = validRoi(rectification, "validRoiRight", width, height);
        cv::Mat mask;
        if (argc > 8 && std::string(argv[8]).size()) {
            mask = cv::imread(argv[8], cv::IMREAD_UNCHANGED);
            if (mask.empty() || mask.type() != CV_8UC1 || mask.cols != width || mask.rows != height)
                throw std::runtime_error("Mask must be a readable same-sized 8-bit single-channel image.");
        }
        std::vector<cv::Vec3d> points;
        std::vector<double> ranges;
        cv::Vec3d sum(0, 0, 0);
        std::size_t masked = 0, invalid = 0, low = 0, borders = 0, geometry = 0, far = 0;
        for (std::size_t index = 0; index < total; ++index) {
            const int x = static_cast<int>(index % width), y = static_cast<int>(index / width);
            const auto& value = values[index];
            if (!value.is_null() && (!value.is_number() || !std::isfinite(value.get<double>())))
                throw std::runtime_error("Disparities must be finite numbers or null.");
            if (!mask.empty() && mask.at<unsigned char>(y, x) == 0) { ++masked; continue; }
            if (value.is_null()) { ++invalid; continue; }
            const double d = value.get<double>();
            if (d <= minimum) { ++low; continue; }
            if (!inside(roiL, x, y) || !inside(roiR, x - d, y)) { ++borders; continue; }
            const double coordinates[] = {static_cast<double>(x), static_cast<double>(y), d, 1};
            double homogeneous[4] = {};
            for (int row = 0; row < 4; ++row)
                for (int col = 0; col < 4; ++col)
                    homogeneous[row] += Q.at<double>(row, col) * coordinates[col];
            if (!std::isfinite(homogeneous[3]) || std::abs(homogeneous[3]) < 1e-12) { ++geometry; continue; }
            const cv::Vec3d point(homogeneous[0] / homogeneous[3], homogeneous[1] / homogeneous[3],
                                  homogeneous[2] / homogeneous[3]);
            const double range = cv::norm(point);
            if (!std::isfinite(range) || point[2] <= 0) { ++geometry; continue; }
            if (range > maximum) { ++far; continue; }
            points.push_back(point);
            ranges.push_back(range);
            sum += point;
        }
        const bool available = points.size() >= static_cast<std::size_t>(minPoints);
        Json mean = nullptr, bearing = nullptr, range = nullptr, azimuth = nullptr, elevation = nullptr;
        if (available) {
            const cv::Vec3d position = sum / static_cast<double>(points.size());
            const double distance = cv::norm(position);
            mean = {position[0], position[1], position[2]};
            bearing = {position[0] / distance, position[1] / distance, position[2] / distance};
            range = distance;
            const double degrees = 180.0 / std::acos(-1);
            azimuth = std::atan2(position[0], position[2]) * degrees;
            elevation = std::atan2(-position[1], std::hypot(position[0], position[2])) * degrees;
        }
        Json stats = nullptr;
        if (!ranges.empty()) {
            double meanRange = 0;
            for (double r : ranges) meanRange += r;
            meanRange /= ranges.size();
            double variance = 0;
            for (double r : ranges) variance += (r - meanRange) * (r - meanRange);
            std::sort(ranges.begin(), ranges.end());
            const auto n = ranges.size();
            stats = {{"meanM", meanRange}, {"medianM", (ranges[(n - 1) / 2] + ranges[n / 2]) / 2},
                     {"minM", ranges.front()}, {"maxM", ranges.back()}, {"stddevM", std::sqrt(variance / n)}};
        }
        const Json result = {
            {"schemaVersion", 1}, {"type", "dense_stereo_position"}, {"units", "m"},
            {"referenceFrame", "rectified_left_camera"}, {"cameraAxes", "x_right_y_down_z_forward"},
            {"referencePoint", "arithmetic_mean_of_accepted_visible_surface_points"},
            {"status", available ? "valid" : "unavailable"},
            {"reason", available ? Json(nullptr) : Json("Insufficient accepted points")},
            {"average_point3d", mean}, {"range_m", range}, {"bearing_unit_vector", bearing},
            {"azimuth_deg", azimuth}, {"elevation_deg", elevation},
            {"pointCount", points.size()}, {"rangeStatistics", stats},
            {"selection", mask.empty() ? "all_accepted_pixels" : "nonzero_mask_pixels"},
            {"counts", {{"total", total}, {"maskedOut", masked}, {"invalidDisparity", invalid},
                        {"belowDisparityLimit", low}, {"outsideValidRoi", borders},
                        {"invalidGeometry", geometry}, {"beyondRangeLimit", far}}},
            {"parameters", {{"minDisparity", minimum}, {"maxRangeM", maximum}, {"minPoints", minPoints}}}
        };
        std::ofstream cloud;
        cloud.exceptions(std::ios::failbit | std::ios::badbit);
        cloud.open(argv[4]);
        cloud << "ply\nformat ascii 1.0\ncomment coordinate_units meters\n"
                 "comment reference_frame rectified_left_camera\nelement vertex " << points.size()
              << "\nproperty double x\nproperty double y\nproperty double z\nend_header\n";
        cloud << std::setprecision(17);
        for (const auto& point : points) cloud << point[0] << ' ' << point[1] << ' ' << point[2] << '\n';
        cloud.close();
        calibration::writeJson(argv[3], result);
        if (!available) std::cerr << "Dense Stereo estimate unavailable: insufficient accepted points (" << points.size() << ").\n";
        else std::cout << "Reconstructed " << points.size() << " points; mean-position range " << range << " m.\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "Dense Stereo failed: " << error.what() << '\n';
        return 2;
    }
}
