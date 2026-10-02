#include <array>

#include <gtest/gtest.h>

#include <opencv2/calib3d.hpp>

#include "common/calibrate/calibration.hpp"

using namespace navlib::common;
using namespace navlib::common::calibrate;

namespace
{
    // Projects a known synthetic board pose through a known camera model, so we can
    // verify calibrate_mono actually recovers the intrinsics we started with.
    std::vector<cv::Point2f> project_view(const cv::Mat &camera_matrix, const cv::Mat &dist_coeffs,
                                           const std::vector<cv::Point3f> &object_points, double rx, double ry,
                                           double tz)
    {
        const cv::Mat rvec = (cv::Mat_<double>(3, 1) << rx, ry, 0.0);
        const cv::Mat tvec = (cv::Mat_<double>(3, 1) << 0.0, 0.0, tz);
        std::vector<cv::Point2f> image_points;
        cv::projectPoints(object_points, rvec, tvec, camera_matrix, dist_coeffs, image_points);
        return image_points;
    }
} // namespace

TEST(CalibrateTest, CheckerboardObjectPointsAreSpacedBySquareSize)
{
    const auto points = checkerboard_object_points(cv::Size(4, 3), 0.025);

    ASSERT_EQ(points.size(), 12u);
    EXPECT_FLOAT_EQ(points[1].x - points[0].x, 0.025f);
    EXPECT_FLOAT_EQ(points[4].y - points[0].y, 0.025f);
}

TEST(CalibrateTest, MonoCalibrationRecoversKnownIntrinsics)
{
    const cv::Size image_size(1280, 960);
    const cv::Mat camera_matrix = (cv::Mat_<double>(3, 3) << 900.0, 0.0, 640.0, 0.0, 900.0, 480.0, 0.0, 0.0, 1.0);
    const cv::Mat dist_coeffs = cv::Mat::zeros(1, 5, CV_64F);

    const auto board_points = checkerboard_object_points(cv::Size(7, 6), 0.03);

    // Varied tilts/distances (never the same pose twice) so the solve is well-conditioned.
    const std::vector<std::array<double, 3>> poses = {
        {0.0, 0.0, 0.6},  {0.25, 0.0, 0.7}, {0.0, 0.3, 0.8}, {-0.3, 0.15, 0.65}, {0.2, -0.25, 0.75}};

    std::vector<std::vector<cv::Point3f>> object_points;
    std::vector<std::vector<cv::Point2f>> image_points;
    for (const auto &pose : poses)
    {
        object_points.push_back(board_points);
        image_points.push_back(project_view(camera_matrix, dist_coeffs, board_points, pose[0], pose[1], pose[2]));
    }

    const auto result = calibrate_mono(object_points, image_points, image_size);

    EXPECT_NEAR(result.intrinsics.fx, 900.0, 5.0);
    EXPECT_NEAR(result.intrinsics.fy, 900.0, 5.0);
    EXPECT_NEAR(result.intrinsics.cx, 640.0, 5.0);
    EXPECT_NEAR(result.intrinsics.cy, 480.0, 5.0);
    EXPECT_LT(result.rms_reprojection_error, 0.5);
}
