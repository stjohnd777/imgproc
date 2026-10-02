#include "common/camera.hpp"

#include <cmath>
#include <stdexcept>

#include <opencv2/core/eigen.hpp>

namespace navlib::common
{

    Eigen::Matrix3d CameraIntrinsics::matrix() const
    {
        Eigen::Matrix3d k = Eigen::Matrix3d::Identity();
        k(0, 0) = fx;
        k(1, 1) = fy;
        k(0, 1) = skew;
        k(0, 2) = cx;
        k(1, 2) = cy;
        return k;
    }

    cv::Mat CameraIntrinsics::toCvMat() const
    {
        cv::Mat k;
        cv::eigen2cv(matrix(), k);
        return k;
    }

    CameraIntrinsics CameraIntrinsics::from_focal_length(double focal_length_mm, double sensor_width_mm,
                                                          double sensor_height_mm, int image_width_px,
                                                          int image_height_px)
    {
        CameraIntrinsics intrinsics;
        intrinsics.fx = focal_length_mm * (static_cast<double>(image_width_px) / sensor_width_mm);
        intrinsics.fy = focal_length_mm * (static_cast<double>(image_height_px) / sensor_height_mm);
        intrinsics.cx = image_width_px / 2.0;
        intrinsics.cy = image_height_px / 2.0;
        intrinsics.image_width = image_width_px;
        intrinsics.image_height = image_height_px;
        return intrinsics;
    }

    CameraIntrinsics CameraIntrinsics::from_fov(double fov_x_rad, double fov_y_rad, int image_width_px,
                                                 int image_height_px)
    {
        CameraIntrinsics intrinsics;
        intrinsics.fx = (image_width_px / 2.0) / std::tan(fov_x_rad / 2.0);
        intrinsics.fy = (image_height_px / 2.0) / std::tan(fov_y_rad / 2.0);
        intrinsics.cx = image_width_px / 2.0;
        intrinsics.cy = image_height_px / 2.0;
        intrinsics.image_width = image_width_px;
        intrinsics.image_height = image_height_px;
        return intrinsics;
    }

    double CameraIntrinsics::fov_x() const
    {
        if (image_width == 0 || fx == 0.0)
        {
            return 0.0;
        }
        return 2.0 * std::atan((image_width / 2.0) / fx);
    }

    double CameraIntrinsics::fov_y() const
    {
        if (image_height == 0 || fy == 0.0)
        {
            return 0.0;
        }
        return 2.0 * std::atan((image_height / 2.0) / fy);
    }

    Pose::Pose(const Eigen::Matrix3d &rotation, const Eigen::Vector3d &translation)
        : rotation_(rotation), translation_(translation) {}

    Pose Pose::identity() { return Pose(); }

    Eigen::Matrix4d Pose::matrix() const
    {
        Eigen::Matrix4d t = Eigen::Matrix4d::Identity();
        t.block<3, 3>(0, 0) = rotation_;
        t.block<3, 1>(0, 3) = translation_;
        return t;
    }

    Pose Pose::inverse() const
    {
        const Eigen::Matrix3d r_inv = rotation_.transpose();
        return Pose(r_inv, -r_inv * translation_);
    }

    Pose Pose::operator*(const Pose &other) const
    {
        return Pose(rotation_ * other.rotation_, rotation_ * other.translation_ + translation_);
    }

    Eigen::Vector3d Pose::transform(const Eigen::Vector3d &point) const
    {
        return rotation_ * point + translation_;
    }

    Eigen::Vector2d project(const CameraIntrinsics &intrinsics, const Eigen::Vector3d &point_camera)
    {
        if (point_camera.z() == 0.0)
        {
            throw std::domain_error("project: point lies on the camera plane (z == 0)");
        }

        const double x = point_camera.x() / point_camera.z();
        const double y = point_camera.y() / point_camera.z();

        return Eigen::Vector2d(
            intrinsics.fx * x + intrinsics.skew * y + intrinsics.cx,
            intrinsics.fy * y + intrinsics.cy);
    }

    Camera Camera::from_focal_length(double focal_length_mm, double sensor_width_mm,
                                      double sensor_height_mm, int image_width_px, int image_height_px,
                                      const Distortion &distortion, const Pose &extrinsics)
    {
        Camera camera;
        camera.intrinsics = CameraIntrinsics::from_focal_length(focal_length_mm, sensor_width_mm,
                                                                 sensor_height_mm, image_width_px,
                                                                 image_height_px);
        camera.distortion = distortion;
        camera.extrinsics = extrinsics;
        return camera;
    }

    Camera Camera::from_fov(double fov_x_rad, double fov_y_rad, int image_width_px, int image_height_px,
                            const Distortion &distortion, const Pose &extrinsics)
    {
        Camera camera;
        camera.intrinsics = CameraIntrinsics::from_fov(fov_x_rad, fov_y_rad, image_width_px, image_height_px);
        camera.distortion = distortion;
        camera.extrinsics = extrinsics;
        return camera;
    }

} // namespace navlib::common
