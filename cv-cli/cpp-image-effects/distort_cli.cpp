#include <iostream>
#include <vector>
#include <opencv2/calib3d.hpp>
#include <opencv2/imgproc.hpp>
#include "image_io.hpp"

struct Parameters {
    std::string input, output;
    double fx, fy, cx, cy, k1, k2, p1, p2, k3;
};

Parameters validate(int argc, char* argv[]) {
    if (argc != 11 && argc != 12) {
        throw std::invalid_argument(
            "Usage: distort_cli <input> <output> <fx> <fy> <cx> <cy> "
            "<k1> <k2> <p1> <p2> [k3]");
    }
    Parameters p{argv[1], argv[2],
        effects::number(argc, argv, 3, "fx", 1000, 1e-12),
        effects::number(argc, argv, 4, "fy", 1000, 1e-12),
        effects::number(argc, argv, 5, "cx", 0),
        effects::number(argc, argv, 6, "cy", 0),
        effects::number(argc, argv, 7, "k1", 0),
        effects::number(argc, argv, 8, "k2", 0),
        effects::number(argc, argv, 9, "p1", 0),
        effects::number(argc, argv, 10, "p2", 0),
        effects::number(argc, argv, 11, "k3", 0)};
    return p;
}

cv::Mat distort(const cv::Mat& image, const Parameters& p) {
    if (p.k1 == 0 && p.k2 == 0 && p.p1 == 0 && p.p2 == 0 && p.k3 == 0) {
        return image.clone();
    }
    const cv::Mat K = (cv::Mat_<double>(3, 3) <<
        p.fx, 0, p.cx, 0, p.fy, p.cy, 0, 0, 1);
    const cv::Mat D = (cv::Mat_<double>(1, 5) << p.k1, p.k2, p.p1, p.p2, p.k3);
    cv::Mat mapX(image.size(), CV_32F), mapY(image.size(), CV_32F);
    std::vector<cv::Point2d> pixels(image.cols), normalized, projected;
    std::vector<cv::Point3d> rays(image.cols);
    for (int y = 0; y < image.rows; ++y) {
        for (int x = 0; x < image.cols; ++x) pixels[x] = cv::Point2d(x, y);
        // Each distorted output pixel samples the corresponding ideal input ray.
        cv::undistortPoints(pixels, normalized, K, D, cv::noArray(), cv::noArray(),
            cv::TermCriteria(cv::TermCriteria::COUNT | cv::TermCriteria::EPS, 100, 1e-9));
        for (int x = 0; x < image.cols; ++x) {
            rays[x] = cv::Point3d(normalized[x].x, normalized[x].y, 1);
            const double u = p.fx * normalized[x].x + p.cx;
            const double v = p.fy * normalized[x].y + p.cy;
            if (!std::isfinite(u) || !std::isfinite(v) ||
                std::abs(u) > 1e7 || std::abs(v) > 1e7) {
                throw std::runtime_error("Distortion produced an invalid sampling map");
            }
            mapX.at<float>(y, x) = static_cast<float>(u);
            mapY.at<float>(y, x) = static_cast<float>(v);
        }
        cv::projectPoints(rays, cv::Vec3d(0, 0, 0), cv::Vec3d(0, 0, 0), K, D, projected);
        for (int x = 0; x < image.cols; ++x) {
            const double error = cv::norm(projected[x] - pixels[x]);
            if (!std::isfinite(error) || error > 0.05) {
                throw std::runtime_error(
                    "Cannot invert distortion over this image; reduce coefficients or check K");
            }
        }
    }
    cv::Mat output;
    cv::remap(image, output, mapX, mapY, cv::INTER_LINEAR, cv::BORDER_CONSTANT, cv::Scalar());
    return output;
}

int main(int argc, char* argv[]) {
    try {
        const Parameters p = validate(argc, argv);
        const cv::Mat output = distort(effects::read(p.input), p);
        effects::write(p.output, output);
        std::cout << p.output << "\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
