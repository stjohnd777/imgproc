#include <opencv2/calib3d.hpp>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <filesystem>
#include <iostream>

int main(int argc, char* argv[]) {
    if (argc != 2) return 1;
    try {
        const std::filesystem::path dir(argv[1]);
        for (const char* side : {"left", "right"}) std::filesystem::create_directories(dir / side);
        const cv::Mat K = (cv::Mat_<double>(3, 3) << 700, 0, 319.5, 0, 700, 239.5, 0, 0, 1);
        const double square = 0.035;
        for (int view = 0; view < 12; ++view) {
            const cv::Vec3d rotation(0.08 + 0.10 * (view % 4), -0.24 + 0.12 * (view % 5), -0.08 + 0.04 * (view % 3));
            for (int side = 0; side < 2; ++side) {
                const cv::Vec3d translation(-0.10 + 0.035 * (view % 3) - side * 0.12,
                    -0.10 + 0.025 * (view % 4), 0.85 + 0.065 * view);
                cv::Mat image(480, 640, CV_8UC1, cv::Scalar(190));
                for (int row = -1; row < 6; ++row) {
                    for (int col = -1; col < 9; ++col) {
                        std::vector<cv::Point3f> corners = {
                            {static_cast<float>(col * square), static_cast<float>(row * square), 0},
                            {static_cast<float>((col + 1) * square), static_cast<float>(row * square), 0},
                            {static_cast<float>((col + 1) * square), static_cast<float>((row + 1) * square), 0},
                            {static_cast<float>(col * square), static_cast<float>((row + 1) * square), 0}
                        };
                        std::vector<cv::Point2f> projected;
                        cv::projectPoints(corners, rotation, translation, K, cv::Mat::zeros(1, 5, CV_64F), projected);
                        std::vector<cv::Point> polygon;
                        for (const auto& point : projected)
                            polygon.emplace_back(cvRound(point.x * 16), cvRound(point.y * 16));
                        cv::fillConvexPoly(image, polygon, cv::Scalar((row + col) % 2 == 0 ? 255 : 0), cv::LINE_AA, 4);
                    }
                }
                const auto filename = dir / (side ? "right" : "left") / ("pair_" + std::to_string(view) + ".png");
                if (!cv::imwrite(filename.string(), image)) throw std::runtime_error("Cannot write fixture.");
            }
        }
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
