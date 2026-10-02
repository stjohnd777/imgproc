#pragma once

#include <Eigen/Dense>
#include <opencv2/core.hpp>

namespace navlib::common
{

    // Pinhole camera intrinsics; K is derived on demand, never stored redundantly.
    struct CameraIntrinsics
    {
        double fx = 0.0;
        double fy = 0.0;
        double cx = 0.0;
        double cy = 0.0;
        double skew = 0.0;
        int image_width = 0;
        int image_height = 0;

        Eigen::Matrix3d matrix() const;

        // Returns K in the given Eigen storage order; defaults to row-major (RowMajor)
        // since that matches the conventional K layout used by row-major/C-style buffers.
        // Element values are identical regardless of order, only the in-memory layout changes.
        template <int StorageOrder = Eigen::RowMajor>
        Eigen::Matrix<double, 3, 3, StorageOrder> asEigen() const
        {
            return matrix();
        }

        // Returns K as a cv::Mat (CV_64F), e.g. for cv::calibrateCamera/solvePnP/stereoRectify.
        cv::Mat toCvMat() const;

        // Derives fx/fy from a physical focal length (mm) + sensor size (mm) and image resolution (px).
        static CameraIntrinsics from_focal_length(double focal_length_mm, double sensor_width_mm,
                                                  double sensor_height_mm, int image_width_px,
                                                  int image_height_px);

        // Derives fx/fy from horizontal/vertical field of view (radians) and image resolution (px).
        static CameraIntrinsics from_fov(double fov_x_rad, double fov_y_rad, int image_width_px,
                                         int image_height_px);

        // Horizontal/vertical field of view (radians), derived from fx/fy and image_width/height.
        double fov_x() const;
        double fov_y() const;
    };

    // Radial/tangential distortion coefficients (OpenCV convention), orthogonal to K.
    struct Distortion
    {
        double k1 = 0.0;
        double k2 = 0.0;
        double p1 = 0.0;
        double p2 = 0.0;
        double k3 = 0.0;
    };

    // Rigid-body transform (SE(3)): rotation (DCM) + translation, held by composition.
    class Pose
    {
    public:
        Pose() = default;
        Pose(const Eigen::Matrix3d &rotation, const Eigen::Vector3d &translation);

        static Pose identity();

        const Eigen::Matrix3d &rotation() const { return rotation_; }
        const Eigen::Vector3d &translation() const { return translation_; }

        Eigen::Matrix4d matrix() const;
        Pose inverse() const;
        Pose operator*(const Pose &other) const;
        Eigen::Vector3d transform(const Eigen::Vector3d &point) const;

    private:
        Eigen::Matrix3d rotation_ = Eigen::Matrix3d::Identity();
        Eigen::Vector3d translation_ = Eigen::Vector3d::Zero();
    };

    // A pinhole camera: intrinsics + distortion + its pose in some reference frame.
    struct Camera
    {
        CameraIntrinsics intrinsics;
        Distortion distortion;
        Pose extrinsics;

        // Convenience factory: build a camera from a physical focal length + sensor size.
        static Camera from_focal_length(double focal_length_mm, double sensor_width_mm,
                                        double sensor_height_mm, int image_width_px,
                                        int image_height_px, const Distortion &distortion = {},
                                        const Pose &extrinsics = Pose::identity());

        // Convenience factory: build a camera from horizontal/vertical field of view.
        static Camera from_fov(double fov_x_rad, double fov_y_rad, int image_width_px,
                               int image_height_px, const Distortion &distortion = {},
                               const Pose &extrinsics = Pose::identity());
    };

    // Projects an undistorted camera-space point onto the image plane (pixels).
    Eigen::Vector2d project(const CameraIntrinsics &intrinsics, const Eigen::Vector3d &point_camera);

} // namespace navlib::common
