#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>
#include <opencv2/core.hpp>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/calib3d.hpp>

#include "cli_args.hpp"

namespace fs = std::filesystem;

struct KeypointInput {
    std::size_t id{0};
    float u{0.0f};
    float v{0.0f};
    float response{0.0f};
};

struct StereoMatch {
    std::size_t leftId{0};
    float ul{0.0f};
    float vl{0.0f};
    float ur{0.0f};
    float vr{0.0f};
    float disparity{0.0f};
    float score{0.0f};
    float x{0.0f};
    float y{0.0f};
    float z{0.0f};
    bool has3d{false};
};

namespace {

bool loadKeypointsJson(const std::string& path, std::vector<KeypointInput>& out) {
    out.clear();
    std::ifstream stream(path);
    if (!stream.is_open()) {
        std::cerr << "Cannot open keypoints JSON: " << path << "\n";
        return false;
    }
    try {
        nlohmann::json doc;
        stream >> doc;
        if (!doc.contains("keypoints") || !doc["keypoints"].is_array()) {
            std::cerr << "Missing or invalid 'keypoints' array in " << path << "\n";
            return false;
        }
        for (const auto& kp : doc["keypoints"]) {
            KeypointInput k;
            k.id = kp.value("id", out.size());
            k.u = kp.value("u", 0.0f);
            k.v = kp.value("v", 0.0f);
            if (kp.contains("response") && !kp["response"].is_null()) {
                k.response = kp["response"].get<float>();
            }
            out.push_back(k);
        }
        return true;
    } catch (const std::exception& e) {
        std::cerr << "JSON parse error in " << path << ": " << e.what() << "\n";
        return false;
    }
}

bool writeMatchesJson(const std::string& destination,
                      const std::string& leftImgPath,
                      const std::string& rightImgPath,
                      const std::string& keypointsPath,
                      const cv::Size& size,
                      const nlohmann::json& parameters,
                      const std::vector<StereoMatch>& matches) {
    try {
        nlohmann::json matchesArray = nlohmann::json::array();
        for (const auto& m : matches) {
            nlohmann::json item = {
                {"leftId", m.leftId},
                {"left", {{"u", m.ul}, {"v", m.vl}}},
                {"right", {{"u", m.ur}, {"v", m.vr}}},
                {"disparity", m.disparity},
                {"score", m.score}
            };
            if (m.has3d) {
                item["point3d"] = {{"x", m.x / 1000.0}, {"y", m.y / 1000.0}, {"z", m.z / 1000.0}};
                item["point3d_mm"] = {{"x", m.x}, {"y", m.y}, {"z", m.z}};
            } else {
                item["point3d"] = nullptr;
                item["point3d_mm"] = nullptr;
            }
            matchesArray.push_back(std::move(item));
        }

        nlohmann::json doc = {
            {"schemaVersion", 1},
            {"type", "stereo_matches"},
            {"method", "EPILINE_1D_CORRELATION"},
            {"coordinateUnits", "m"},
            {"parameters", parameters},
            {"images", {
                {"left", fs::absolute(leftImgPath).lexically_normal().string()},
                {"right", fs::absolute(rightImgPath).lexically_normal().string()},
                {"width", size.width},
                {"height", size.height}
            }},
            {"keypointsSource", fs::absolute(keypointsPath).lexically_normal().string()},
            {"count", matches.size()},
            {"matches", matchesArray}
        };

        std::ofstream out(destination);
        out.exceptions(std::ios::failbit | std::ios::badbit);
        out << doc.dump(2) << "\n";
        out.close();
        return true;
    } catch (const std::exception& e) {
        std::cerr << "Failed to write matches JSON to " << destination << ": " << e.what() << "\n";
        return false;
    }
}

bool writePlyPointCloud(const std::string& destination, const std::vector<StereoMatch>& matches, const cv::Mat& colorImg) {
    try {
        std::vector<StereoMatch> valid3d;
        for (const auto& m : matches) {
            if (m.has3d && std::isfinite(m.x) && std::isfinite(m.y) && std::isfinite(m.z) && m.z > 0.0f) {
                valid3d.push_back(m);
            }
        }

        std::ofstream out(destination);
        out.exceptions(std::ios::failbit | std::ios::badbit);

        out << "ply\n";
        out << "format ascii 1.0\n";
        out << "comment coordinate_units meters\n";
        out << "element vertex " << valid3d.size() << "\n";
        out << "property float x\n";
        out << "property float y\n";
        out << "property float z\n";
        out << "property uchar red\n";
        out << "property uchar green\n";
        out << "property uchar blue\n";
        out << "end_header\n";

        for (const auto& m : valid3d) {
            int px = std::clamp(static_cast<int>(std::round(m.ul)), 0, colorImg.cols - 1);
            int py = std::clamp(static_cast<int>(std::round(m.vl)), 0, colorImg.rows - 1);
            cv::Vec3b bgr(128, 128, 128);
            if (!colorImg.empty()) {
                if (colorImg.channels() == 3) {
                    bgr = colorImg.at<cv::Vec3b>(py, px);
                } else {
                    uchar gray = colorImg.at<uchar>(py, px);
                    bgr = cv::Vec3b(gray, gray, gray);
                }
            }
            out << m.x / 1000.0 << " " << m.y / 1000.0 << " " << m.z / 1000.0 << " "
                << static_cast<int>(bgr[2]) << " "
                << static_cast<int>(bgr[1]) << " "
                << static_cast<int>(bgr[0]) << "\n";
        }
        out.close();
        return true;
    } catch (const std::exception& e) {
        std::cerr << "Failed to write PLY pointcloud to " << destination << ": " << e.what() << "\n";
        return false;
    }
}

bool writePoints3dJson(const std::string& destination,
                       const std::vector<StereoMatch>& matches,
                       const cv::Size& size,
                       double baselineMm, double fx, double fy, double cx, double cy) {
    try {
        std::vector<float> zMetersList;
        nlohmann::json ptsArray = nlohmann::json::array();
        for (const auto& m : matches) {
            if (m.has3d && std::isfinite(m.x) && std::isfinite(m.y) && std::isfinite(m.z) && m.z > 0.0f) {
                float dist_m = m.z / 1000.0f; // baseline was in mm, so z is in mm
                zMetersList.push_back(dist_m);
                ptsArray.push_back({
                    {"id", m.leftId},
                    {"left", {{"u", m.ul}, {"v", m.vl}}},
                    {"right", {{"u", m.ur}, {"v", m.vr}}},
                    {"disparity_px", m.disparity},
                    {"distance_meters", std::round(dist_m * 1000.0) / 1000.0},
                    {"point3d_meters", {
                        {"x", std::round((m.x / 1000.0f) * 1000.0) / 1000.0},
                        {"y", std::round((m.y / 1000.0f) * 1000.0) / 1000.0},
                        {"z", std::round((m.z / 1000.0f) * 1000.0) / 1000.0}
                    }},
                    {"point3d_mm", {
                        {"x", std::round(m.x * 10.0) / 10.0},
                        {"y", std::round(m.y * 10.0) / 10.0},
                        {"z", std::round(m.z * 10.0) / 10.0}
                    }},
                    {"score", m.score}
                });
            }
        }

        nlohmann::json summary = {
            {"minDistanceMeters", nullptr},
            {"maxDistanceMeters", nullptr},
            {"meanDistanceMeters", nullptr},
            {"medianDistanceMeters", nullptr}
        };

        if (!zMetersList.empty()) {
            std::sort(zMetersList.begin(), zMetersList.end());
            float minZ = zMetersList.front();
            float maxZ = zMetersList.back();
            double sumZ = 0;
            for (float val : zMetersList) sumZ += val;
            float meanZ = static_cast<float>(sumZ / zMetersList.size());
            float medianZ = zMetersList[zMetersList.size() / 2];

            summary["minDistanceMeters"] = std::round(minZ * 1000.0) / 1000.0;
            summary["maxDistanceMeters"] = std::round(maxZ * 1000.0) / 1000.0;
            summary["meanDistanceMeters"] = std::round(meanZ * 1000.0) / 1000.0;
            summary["medianDistanceMeters"] = std::round(medianZ * 1000.0) / 1000.0;
        }

        nlohmann::json doc = {
            {"schemaVersion", 1},
            {"type", "pointcloud_points3d"},
            {"method", "EPILINE_1D_TRIANGULATION"},
            {"camera", {
                {"baselineMm", baselineMm},
                {"fx_pixels", fx},
                {"fy_pixels", fy},
                {"cx_pixels", cx},
                {"cy_pixels", cy},
                {"imageWidth", size.width},
                {"imageHeight", size.height}
            }},
            {"count", ptsArray.size()},
            {"distanceSummary", summary},
            {"points", ptsArray}
        };

        std::ofstream out(destination);
        out.exceptions(std::ios::failbit | std::ios::badbit);
        out << doc.dump(2) << "\n";
        out.close();
        return true;
    } catch (const std::exception& e) {
        std::cerr << "Failed to write points3d JSON to " << destination << ": " << e.what() << "\n";
        return false;
    }
}

bool writePositionEstimateJson(const std::string& destination,
                               const std::vector<cv::Vec3d>& pointCloud,
                               const cv::Vec3d& averagePoint3d) {
    try {
        nlohmann::json average = nullptr;
        if (!pointCloud.empty()) {
            average = nlohmann::json::array({
                averagePoint3d[0] / 1000.0,
                averagePoint3d[1] / 1000.0,
                averagePoint3d[2] / 1000.0
            });
        }

        nlohmann::json points = nlohmann::json::array();
        for (const auto& point : pointCloud) {
            points.push_back({point[0] / 1000.0, point[1] / 1000.0, point[2] / 1000.0});
        }

        nlohmann::json doc = {
            {"average_point3d", average},
            {"point_cloud", points},
            {"units", "m"}
        };

        std::ofstream out(destination);
        out.exceptions(std::ios::failbit | std::ios::badbit);
        out << doc.dump(2) << "\n";
        out.close();
        return true;
    } catch (const std::exception& e) {
        std::cerr << "Failed to write position estimate JSON to " << destination << ": " << e.what() << "\n";
        return false;
    }
}

} // namespace

int main(int argc, char* argv[]) {
    if (argc < 7) {
        std::cerr << "Usage: simple_stereo_cli <imageL> <imageR> <leftKeypointsJson> <outPreview> <outMatchesJson> <outPoints3d>\n"
                  << "                         [maxDisparity] [patchRadius] [vTolerance] [minCorrelation] [baselineMm] [fx] [fy] [cx] [cy] [outPositionEstimateJson]\n";
        return 1;
    }

    const std::string imgL_path = argv[1];
    const std::string imgR_path = argv[2];
    const std::string kp_path   = argv[3];
    const std::string out_prev  = argv[4];
    const std::string out_match = argv[5];
    const std::string out_ply   = argv[6];

    // Optional parameters
    const int maxDisparity = cli::intArg(argc, argv, 7, "maxDisparity", 64, 1, 1000);
    const int patchRadius  = cli::intArg(argc, argv, 8, "patchRadius", 4, 1, 32); // patch width = 2*r + 1
    const double vTol      = cli::doubleArg(argc, argv, 9, "vTolerance", 1.0, 0.0, 10.0);
    const double minCorr   = cli::doubleArg(argc, argv, 10, "minCorrelation", 0.60, -1.0, 1.0);
    const double baseline  = cli::doubleArg(argc, argv, 11, "baselineMm", 120.0, 0.001, 100000.0);
    const double fx        = cli::doubleArg(argc, argv, 12, "fx", 1000.0, 0.001, 100000.0);
    const double fy        = cli::doubleArg(argc, argv, 13, "fy", fx, 0.001, 100000.0);
    const double cx        = cli::doubleArg(argc, argv, 14, "cx", -1.0, -1.0, 100000.0);
    const double cy        = cli::doubleArg(argc, argv, 15, "cy", -1.0, -1.0, 100000.0);

    const cv::Mat imgL = cv::imread(imgL_path, cv::IMREAD_COLOR);
    if (imgL.empty()) {
        std::cerr << "Failed to read left image: " << imgL_path << "\n";
        return 2;
    }
    const cv::Mat imgR = cv::imread(imgR_path, cv::IMREAD_COLOR);
    if (imgR.empty()) {
        std::cerr << "Failed to read right image: " << imgR_path << "\n";
        return 2;
    }

    if (imgL.size() != imgR.size()) {
        std::cerr << "Left and right image dimensions do not match: "
                  << imgL.size() << " vs " << imgR.size() << "\n";
        return 2;
    }

    std::vector<KeypointInput> keypoints;
    if (!loadKeypointsJson(kp_path, keypoints)) {
        return 2;
    }

    cv::Mat grayL, grayR;
    cv::cvtColor(imgL, grayL, cv::COLOR_BGR2GRAY);
    cv::cvtColor(imgR, grayR, cv::COLOR_BGR2GRAY);

    const int width = imgL.cols;
    const int height = imgL.rows;
    const double principalX = cx < 0.0 ? (width - 1) / 2.0 : cx;
    const double principalY = cy < 0.0 ? (height - 1) / 2.0 : cy;

    std::vector<StereoMatch> matches;
    matches.reserve(keypoints.size());

    const int r = patchRadius;
    const int patchSize = 2 * r + 1;

    for (const auto& kp : keypoints) {
        const int ul_int = static_cast<int>(std::round(kp.u));
        const int vl_int = static_cast<int>(std::round(kp.v));

        if (ul_int - r < 0 || ul_int + r >= width || vl_int - r < 0 || vl_int + r >= height) {
            continue;
        }

        const cv::Rect leftRect(ul_int - r, vl_int - r, patchSize, patchSize);
        const cv::Mat leftPatch = grayL(leftRect);

        // Disparity is non-negative for rectified cameras with standard baseline: ur <= ul.
        // We search within [ul - maxDisparity, ul].
        const int minUr = std::max(r, ul_int - maxDisparity);
        const int maxUr = std::min(width - 1 - r, ul_int);
        if (minUr > maxUr) continue;

        // Search in a small vertical band around vl_int ([-vTol, +vTol])
        const int vStep = static_cast<int>(std::ceil(vTol));
        float bestCorr = -10.0f;
        float bestUr = -1.0f;
        float bestVr = -1.0f;

        for (int vOffset = -vStep; vOffset <= vStep; ++vOffset) {
            const int currVr = vl_int + vOffset;
            if (currVr - r < 0 || currVr + r >= height) continue;

            const cv::Rect searchStrip(minUr - r, currVr - r, (maxUr - minUr) + patchSize, patchSize);
            const cv::Mat rightStrip = grayR(searchStrip);

            cv::Mat nccResult;
            cv::matchTemplate(rightStrip, leftPatch, nccResult, cv::TM_CCOEFF_NORMED);

            for (int col = 0; col < nccResult.cols; ++col) {
                float val = nccResult.at<float>(0, col);
                if (val > bestCorr) {
                    bestCorr = val;
                    bestUr = static_cast<float>(minUr + col);
                    bestVr = static_cast<float>(currVr);
                }
            }
        }

        if (bestCorr >= static_cast<float>(minCorr) && bestUr >= 0.0f) {
            StereoMatch m;
            m.leftId = kp.id;
            m.ul = kp.u;
            m.vl = kp.v;
            m.ur = bestUr;
            m.vr = bestVr;
            m.disparity = kp.u - bestUr;
            m.score = bestCorr;

            if (m.disparity > 0.001f && fx > 0.0f && baseline > 0.0f) {
                // Triangulation: Z in millimeters if baseline in mm, or meters if baseline in meters
                m.z = static_cast<float>((fx * baseline) / m.disparity);
                m.x = static_cast<float>((m.ul - principalX) * m.z / fx);
                m.y = static_cast<float>((m.vl - principalY) * m.z / fy);
                m.has3d = true;
            } else {
                m.has3d = false;
            }
            matches.push_back(m);
        }
    }

    std::vector<cv::Vec3d> pointCloud;
    cv::Vec3d averagePoint3d(0.0, 0.0, 0.0);
    for (const auto& match : matches) {
        if (match.has3d && std::isfinite(match.x) && std::isfinite(match.y) && std::isfinite(match.z) && match.z > 0.0f) {
            pointCloud.emplace_back(match.x, match.y, match.z);
            averagePoint3d += cv::Vec3d(match.x, match.y, match.z);
        }
    }
    if (!pointCloud.empty()) {
        averagePoint3d *= 1.0 / static_cast<double>(pointCloud.size());
    }

    // Render preview: left image with epipolar vectors / circles
    cv::Mat preview = imgL.clone();
    for (const auto& m : matches) {
        cv::Point2f pL(m.ul, m.vl);
        // Draw matched point in green
        cv::circle(preview, pL, 3, cv::Scalar(0, 255, 0), -1, cv::LINE_AA);
        // Draw disparity vector toward left in cyan to indicate where it landed in right
        cv::Point2f pR(m.ur, m.vr);
        cv::line(preview, pL, cv::Point2f(pL.x - m.disparity, pL.y), cv::Scalar(255, 255, 0), 1, cv::LINE_AA);
    }

    std::string summaryText = "Matches: " + std::to_string(matches.size()) + " / " + std::to_string(keypoints.size());
    cv::putText(preview, summaryText, cv::Point(16, 32), cv::FONT_HERSHEY_SIMPLEX, 0.8, cv::Scalar(0, 0, 0), 3, cv::LINE_AA);
    cv::putText(preview, summaryText, cv::Point(16, 32), cv::FONT_HERSHEY_SIMPLEX, 0.8, cv::Scalar(0, 255, 255), 1, cv::LINE_AA);

    std::ostringstream positionLabel;
    positionLabel << "Mean position (m): ";
    if (pointCloud.empty()) {
        positionLabel << "unavailable";
    } else {
        positionLabel << std::fixed << std::setprecision(3)
                  << "[" << averagePoint3d[0] / 1000.0 << ", "
                  << averagePoint3d[1] / 1000.0 << ", "
                  << averagePoint3d[2] / 1000.0 << "]";
    }
    const std::string positionText = positionLabel.str();
    const int positionThickness = 1;
    double positionScale = 0.65;
    int positionBaseline = 0;
    cv::Size positionSize = cv::getTextSize(positionText, cv::FONT_HERSHEY_SIMPLEX, positionScale, positionThickness, &positionBaseline);
    if (positionSize.width > preview.cols - 24) {
        positionScale *= static_cast<double>(preview.cols - 24) / positionSize.width;
        positionSize = cv::getTextSize(positionText, cv::FONT_HERSHEY_SIMPLEX, positionScale, positionThickness, &positionBaseline);
    }
    const int positionX = std::max(8, preview.cols - positionSize.width - 16);
    const int positionY = positionSize.height + positionBaseline + 12;
    cv::rectangle(preview,
                  cv::Point(positionX - 8, positionY - positionSize.height - 8),
                  cv::Point(positionX + positionSize.width + 8, positionY + positionBaseline + 8),
                  cv::Scalar(0, 0, 0), cv::FILLED);
    cv::putText(preview, positionText, cv::Point(positionX, positionY), cv::FONT_HERSHEY_SIMPLEX,
                positionScale, cv::Scalar(0, 255, 255), positionThickness, cv::LINE_AA);

    if (!cv::imwrite(out_prev, preview)) {
        std::cerr << "Failed to write preview image to " << out_prev << "\n";
        return 3;
    }

    nlohmann::json paramsDoc = {
        {"maxDisparity", maxDisparity},
        {"patchRadius", patchRadius},
        {"vTolerance", vTol},
        {"minCorrelation", minCorr},
        {"baselineMm", baseline},
        {"fx", fx},
        {"fy", fy},
        {"cx", principalX},
        {"cy", principalY}
    };

    if (!writeMatchesJson(out_match, imgL_path, imgR_path, kp_path, imgL.size(), paramsDoc, matches)) {
        return 3;
    }

    std::string ply_dest = out_ply;
    std::string json_pts_dest = out_ply;

    if (out_ply.size() >= 5 && out_ply.substr(out_ply.size() - 5) == ".json") {
        json_pts_dest = out_ply;
        ply_dest = out_ply.substr(0, out_ply.size() - 5) + ".ply";
    } else if (out_ply.size() >= 4 && out_ply.substr(out_ply.size() - 4) == ".ply") {
        ply_dest = out_ply;
        json_pts_dest = out_ply.substr(0, out_ply.size() - 4) + ".json";
    }

    if (!writePoints3dJson(json_pts_dest, matches, imgL.size(), baseline, fx, fy, principalX, principalY)) {
        std::cerr << "Warning: could not write 3d points JSON to " << json_pts_dest << "\n";
    }
    writePlyPointCloud(ply_dest, matches, imgL);

    fs::path estimatePath = argc > 16 ? fs::path(argv[16]) : fs::path(out_ply);
    if (argc <= 16) estimatePath.replace_extension(".position_estimate.json");
    if (!writePositionEstimateJson(estimatePath.string(), pointCloud, averagePoint3d)) {
        return 3;
    }

    std::cout << out_prev << "\n";
    std::cout << "Matched " << matches.size() << " of " << keypoints.size() << " keypoints.\n";
    return 0;
}
