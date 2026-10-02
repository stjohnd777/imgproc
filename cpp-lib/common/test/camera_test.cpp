#include <gtest/gtest.h>

#include "common/camera.hpp"

TEST(CameraIntrinsicsTest, MatrixLayout)
{
    navlib::common::CameraIntrinsics intrinsics{100.0, 200.0, 320.0, 240.0, 0.0};
    const auto k = intrinsics.matrix();

    EXPECT_DOUBLE_EQ(k(0, 0), 100.0);
    EXPECT_DOUBLE_EQ(k(1, 1), 200.0);
    EXPECT_DOUBLE_EQ(k(0, 2), 320.0);
    EXPECT_DOUBLE_EQ(k(1, 2), 240.0);
    EXPECT_DOUBLE_EQ(k(2, 2), 1.0);
}

TEST(PoseTest, InverseComposesToIdentity)
{
    const Eigen::Matrix3d r = Eigen::AngleAxisd(0.3, Eigen::Vector3d::UnitZ()).toRotationMatrix();
    const navlib::common::Pose pose(r, Eigen::Vector3d(1.0, 2.0, 3.0));

    const auto identity = pose * pose.inverse();

    EXPECT_TRUE(identity.rotation().isApprox(Eigen::Matrix3d::Identity(), 1e-9));
    // isApprox is unreliable against an exact zero vector (relative-tolerance divides by norm==0).
    EXPECT_LT(identity.translation().norm(), 1e-9);
}

TEST(ProjectTest, PrincipalPointMapsForwardAxis)
{
    navlib::common::CameraIntrinsics intrinsics{100.0, 100.0, 320.0, 240.0, 0.0};
    const auto pixel = navlib::common::project(intrinsics, Eigen::Vector3d(0.0, 0.0, 1.0));

    EXPECT_DOUBLE_EQ(pixel.x(), 320.0);
    EXPECT_DOUBLE_EQ(pixel.y(), 240.0);
}

TEST(CameraIntrinsicsTest, FromFocalLengthMatchesManualDerivation)
{
    // 50mm lens, APS-C-ish 23.5x15.6mm sensor, 1920x1280 image.
    const auto intrinsics =
        navlib::common::CameraIntrinsics::from_focal_length(50.0, 23.5, 15.6, 1920, 1280);

    EXPECT_DOUBLE_EQ(intrinsics.fx, 50.0 * (1920.0 / 23.5));
    EXPECT_DOUBLE_EQ(intrinsics.fy, 50.0 * (1280.0 / 15.6));
    EXPECT_DOUBLE_EQ(intrinsics.cx, 960.0);
    EXPECT_DOUBLE_EQ(intrinsics.cy, 640.0);
}

TEST(CameraIntrinsicsTest, FromFovRoundTripsThroughFovAccessors)
{
    const double fov_x = 1.2;
    const double fov_y = 0.9;
    const auto intrinsics = navlib::common::CameraIntrinsics::from_fov(fov_x, fov_y, 1920, 1080);

    EXPECT_NEAR(intrinsics.fov_x(), fov_x, 1e-9);
    EXPECT_NEAR(intrinsics.fov_y(), fov_y, 1e-9);
}

TEST(CameraTest, FromFocalLengthBuildsUsableCamera)
{
    const auto camera = navlib::common::Camera::from_focal_length(50.0, 23.5, 15.6, 1920, 1280);

    EXPECT_GT(camera.intrinsics.fx, 0.0);
    EXPECT_TRUE(camera.extrinsics.rotation().isApprox(Eigen::Matrix3d::Identity()));
}

