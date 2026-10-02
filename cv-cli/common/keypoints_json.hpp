#pragma once

#include <filesystem>
#include <fstream>
#include <iostream>
#include <vector>
#include <nlohmann/json.hpp>
#include <opencv2/core.hpp>

namespace cli {

// An explicit workflow path takes precedence; otherwise the image and JSON share a stem.
inline std::string keypointsPath(int argc, char* argv[], const std::string& preview) {
    if (argc > 3 && std::string(argv[3]).size()) return argv[3];
    auto path = std::filesystem::path(preview);
    path.replace_extension(".keypoints.json");
    return path.string();
}

inline nlohmann::json pointJson(float u, float v, std::size_t id) {
    return {{"id", id}, {"u", u}, {"v", v}, {"sizePx", nullptr},
            {"angleDeg", nullptr}, {"response", nullptr}, {"octave", nullptr},
            {"descriptorRow", nullptr}};
}

inline nlohmann::json enumerateKeypoints(const std::vector<cv::KeyPoint>& points, bool plain = false) {
    auto result = nlohmann::json::array();
    for (std::size_t i = 0; i < points.size(); ++i) {
        const auto& p = points[i];
        auto item = pointJson(p.pt.x, p.pt.y, i);
        item["response"] = p.response;
        if (!plain) {
            if (p.size > 0) item["sizePx"] = p.size;
            if (p.angle >= 0) item["angleDeg"] = p.angle;
            item["octave"] = p.octave;
        }
        result.push_back(std::move(item));
    }
    return result;
}

inline nlohmann::json enumerateKeypoints(const std::vector<cv::Point2f>& points) {
    auto result = nlohmann::json::array();
    for (std::size_t i = 0; i < points.size(); ++i) {
        result.push_back(pointJson(points[i].x, points[i].y, i));
    }
    return result;
}

// A successful CLI run requires BOTH artifacts. Paths are absolute to remove ambiguity
// when a caller supplies a JSON destination in a different directory from the preview.
inline bool writeKeypointsJson(const std::string& destination, const std::string& input,
                              const std::string& preview, const cv::Size& size,
                              const std::string& detector, const nlohmann::json& parameters,
                              const nlohmann::json& keypoints) {
    namespace fs = std::filesystem;
    try {
        const auto target = fs::absolute(destination).lexically_normal();
        if (target == fs::absolute(input).lexically_normal() ||
            target == fs::absolute(preview).lexically_normal()) {
            throw std::runtime_error("JSON path must differ from input and preview paths");
        }
        const nlohmann::json document = {
            {"schemaVersion", 1}, {"type", "keypoints"}, {"detector", detector},
            {"parameters", parameters},
            {"image", {{"path", fs::absolute(input).lexically_normal().string()},
                       {"width", size.width}, {"height", size.height},
                       {"coordinateSpace", "input_image_pixel"},
                       {"origin", "top_left"}, {"uDirection", "right"},
                       {"vDirection", "down"}, {"pixelCenterConvention", "integer"}}},
            {"preview", {{"path", fs::absolute(preview).lexically_normal().string()}}},
            {"count", keypoints.size()}, {"keypoints", keypoints}, {"descriptors", nullptr}
        };
        std::ofstream out(destination);
        out.exceptions(std::ios::failbit | std::ios::badbit);
        out << document.dump(2) << '\n';
        out.close();
        return true;
    } catch (const std::exception& error) {
        std::cerr << "Failed to write keypoints JSON: " << error.what() << '\n';
        return false;
    }
}

} // namespace cli
