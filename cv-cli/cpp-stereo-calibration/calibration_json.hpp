#pragma once
#include <opencv2/core.hpp>
#include <nlohmann/json.hpp>
#include <fstream>
#include <cmath>
#include <stdexcept>

namespace calibration {
using Json = nlohmann::json;

inline Json matrixJson(const cv::Mat& matrix) {
    cv::Mat values;
    matrix.convertTo(values, CV_64F);
    Json result = Json::array();
    for (int row = 0; row < values.rows; ++row) {
        Json line = Json::array();
        for (int col = 0; col < values.cols; ++col) {
            const double value = values.at<double>(row, col);
            if (!std::isfinite(value)) throw std::runtime_error("Calibration produced a non-finite matrix.");
            line.push_back(value);
        }
        result.push_back(line);
    }
    return result;
}

inline cv::Mat readMatrix(const Json& doc, const char* name, int rows, int cols) {
    const auto& array = doc.at(name);
    if (!array.is_array() || array.size() != static_cast<std::size_t>(rows))
        throw std::runtime_error(std::string(name) + " has incorrect row count.");
    cv::Mat result(rows, cols, CV_64F);
    for (int row = 0; row < rows; ++row) {
        if (!array[row].is_array() || array[row].size() != static_cast<std::size_t>(cols))
            throw std::runtime_error(std::string(name) + " has incorrect column count.");
        for (int col = 0; col < cols; ++col) {
            if (!array[row][col].is_number()) throw std::runtime_error(std::string(name) + " must be numeric.");
            const double value = array[row][col].get<double>();
            if (!std::isfinite(value)) throw std::runtime_error(std::string(name) + " must be finite.");
            result.at<double>(row, col) = value;
        }
    }
    return result;
}

inline cv::Mat readDistortion(const Json& doc, const char* name) {
    const auto& values = doc.at(name);
    if (!values.is_array() || values.size() != 5)
        throw std::runtime_error(std::string(name) + " must contain [k1,k2,p1,p2,k3].");
    Json wrapper = {{name, Json::array({values})}};
    return readMatrix(wrapper, name, 1, 5);
}

inline void writeJson(const char* filename, const Json& doc) {
    std::ofstream output;
    output.exceptions(std::ios::failbit | std::ios::badbit);
    output.open(filename);
    output << doc.dump(2) << '\n';
    output.close();
}

inline void validateK(const cv::Mat& K) {
    if (K.at<double>(0, 0) <= 0 || K.at<double>(1, 1) <= 0 ||
        std::abs(K.at<double>(0, 1)) > 1e-9 || std::abs(K.at<double>(1, 0)) > 1e-9 ||
        std::abs(K.at<double>(2, 0)) > 1e-9 || std::abs(K.at<double>(2, 1)) > 1e-9 ||
        std::abs(K.at<double>(2, 2) - 1) > 1e-9)
        throw std::runtime_error("K must have positive focal lengths, zero skew, and bottom row [0,0,1].");
}
}
