#include "common/calibrate/calibration.hpp"

#include <opencv2/calib3d.hpp>
#include <opencv2/core/eigen.hpp>
#include <opencv2/imgproc.hpp>

namespace navlib::common::calibrate
{

    std::vector<cv::Point3f> checkerboard_object_points(cv::Size pattern_size, double square_size)
    {
        std::vector<cv::Point3f> points;
        points.reserve(static_cast<size_t>(pattern_size.width) * static_cast<size_t>(pattern_size.height));
        for (int row = 0; row < pattern_size.height; ++row)
        {
            for (int col = 0; col < pattern_size.width; ++col)
            {
                points.emplace_back(static_cast<float>(col * square_size), static_cast<float>(row * square_size),
                                     0.0f);
            }
        }
        return points;
    }

    namespace
    {
        CameraIntrinsics intrinsics_from_camera_matrix(const cv::Mat &camera_matrix)
        {
            CameraIntrinsics intrinsics;
            intrinsics.fx = camera_matrix.at<double>(0, 0);
            intrinsics.fy = camera_matrix.at<double>(1, 1);
            intrinsics.skew = camera_matrix.at<double>(0, 1);
            intrinsics.cx = camera_matrix.at<double>(0, 2);
            intrinsics.cy = camera_matrix.at<double>(1, 2);
            return intrinsics;
        }

        Distortion distortion_from_coeffs(const cv::Mat &coeffs)
        {
            const int count = coeffs.rows * coeffs.cols;
            auto at = [&](int i) { return i < count ? coeffs.at<double>(i) : 0.0; };

            Distortion distortion;
            distortion.k1 = at(0);
            distortion.k2 = at(1);
            distortion.p1 = at(2);
            distortion.p2 = at(3);
            distortion.k3 = at(4);
            return distortion;
        }

        cv::Mat distortion_to_coeffs(const Distortion &distortion)
        {
            return (cv::Mat_<double>(1, 5) << distortion.k1, distortion.k2, distortion.p1, distortion.p2,
                    distortion.k3);
        }
    } // namespace

    MonoCalibration calibrate_mono(const std::vector<std::vector<cv::Point3f>> &object_points,
                                    const std::vector<std::vector<cv::Point2f>> &image_points,
                                    cv::Size image_size)
    {
        cv::Mat camera_matrix, dist_coeffs;
        std::vector<cv::Mat> rvecs, tvecs;

        const double rms =
            cv::calibrateCamera(object_points, image_points, image_size, camera_matrix, dist_coeffs, rvecs, tvecs);

        MonoCalibration result;
        result.intrinsics = intrinsics_from_camera_matrix(camera_matrix);
        result.intrinsics.image_width = image_size.width;
        result.intrinsics.image_height = image_size.height;
        result.distortion = distortion_from_coeffs(dist_coeffs);
        result.rms_reprojection_error = rms;
        return result;
    }

    UndistortRectifyMap UndistortRectifyMap::to_fixed_point() const
    {
        UndistortRectifyMap fixed;
        cv::convertMaps(map_x, map_y, fixed.map_x, fixed.map_y, CV_16SC2);
        return fixed;
    }

    UndistortRectifyMap build_undistort_rectify_map(const CameraIntrinsics &intrinsics, const Distortion &distortion,
                                                     const cv::Mat &rectification_rotation,
                                                     const cv::Mat &rectified_projection, cv::Size image_size)
    {
        UndistortRectifyMap maps;
        cv::initUndistortRectifyMap(intrinsics.toCvMat(), distortion_to_coeffs(distortion), rectification_rotation,
                                     rectified_projection, image_size, CV_32FC1, maps.map_x, maps.map_y);
        return maps;
    }

    StereoCalibration calibrate_stereo(const std::vector<StereoView> &views, cv::Size image_size)
    {
        std::vector<std::vector<cv::Point3f>> object_points;
        std::vector<std::vector<cv::Point2f>> image_points_left;
        std::vector<std::vector<cv::Point2f>> image_points_right;
        object_points.reserve(views.size());
        image_points_left.reserve(views.size());
        image_points_right.reserve(views.size());
        for (const auto &view : views)
        {
            object_points.push_back(view.object_points);
            image_points_left.push_back(view.image_points_left);
            image_points_right.push_back(view.image_points_right);
        }

        StereoCalibration result;
        result.left = calibrate_mono(object_points, image_points_left, image_size);
        result.right = calibrate_mono(object_points, image_points_right, image_size);

        const cv::Mat camera_matrix_left = result.left.intrinsics.toCvMat();
        const cv::Mat camera_matrix_right = result.right.intrinsics.toCvMat();
        const cv::Mat dist_left = distortion_to_coeffs(result.left.distortion);
        const cv::Mat dist_right = distortion_to_coeffs(result.right.distortion);

        // R/T solved here (intrinsics held fixed from the mono calibrations above) are the
        // rigid transform from the left camera frame to the right camera frame.
        cv::Mat R, T, E, F;
        cv::stereoCalibrate(object_points, image_points_left, image_points_right, camera_matrix_left, dist_left,
                             camera_matrix_right, dist_right, image_size, R, T, E, F, cv::CALIB_FIX_INTRINSIC);

        Eigen::Matrix3d rotation;
        cv::cv2eigen(R, rotation);
        Eigen::Vector3d translation;
        cv::cv2eigen(T, translation);
        result.left_to_right = Pose(rotation, translation);

        cv::Mat R1, R2, P1, P2, Q;
        cv::stereoRectify(camera_matrix_left, dist_left, camera_matrix_right, dist_right, image_size, R, T, R1, R2,
                           P1, P2, Q);
        result.disparity_to_depth_q = Q;

        result.left_map = build_undistort_rectify_map(result.left.intrinsics, result.left.distortion, R1, P1,
                                                        image_size);
        result.right_map = build_undistort_rectify_map(result.right.intrinsics, result.right.distortion, R2, P2,
                                                         image_size);

        return result;
    }

} // namespace navlib::common::calibrate
