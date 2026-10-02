#pragma once

#include <vector>

#include <opencv2/core.hpp>

#include "common/camera.hpp"

namespace navlib::common::calibrate
{

    // Generates the known 3D object points (Z=0 plane) for a checkerboard's inner corners,
    // spaced by square_size (same physical units you want K/T reported in, e.g. meters).
    std::vector<cv::Point3f> checkerboard_object_points(cv::Size pattern_size, double square_size);

    // Result of calibrating a single camera from several checkerboard views.
    struct MonoCalibration
    {
        CameraIntrinsics intrinsics;
        Distortion distortion;
        double rms_reprojection_error = 0.0;
    };

    // Runs cv::calibrateCamera over all views. object_points is the same board geometry
    // repeated once per view (see checkerboard_object_points); image_points are the
    // corresponding detected (and cornerSubPix-refined) corners for that view.
    MonoCalibration calibrate_mono(const std::vector<std::vector<cv::Point3f>> &object_points,
                                   const std::vector<std::vector<cv::Point2f>> &image_points,
                                   cv::Size image_size);

    // A rectified undistort map pair (map_x, map_y) for cv::remap or an FPGA remap core.
    struct UndistortRectifyMap
    {
        cv::Mat map_x;
        cv::Mat map_y;

        // Converts to the fixed-point (CV_16SC2 + CV_16UC1) format most hardware remap
        // cores (including typical Xilinx/Vitis remap IP) expect instead of float maps.
        UndistortRectifyMap to_fixed_point() const;
    };

    // Builds the undistort+rectify map for one camera. rectification_rotation/rectified_projection
    // are that camera's R1/P1 (or R2/P2) from cv::stereoRectify.
    UndistortRectifyMap build_undistort_rectify_map(const CameraIntrinsics &intrinsics,
                                                    const Distortion &distortion,
                                                    const cv::Mat &rectification_rotation,
                                                    const cv::Mat &rectified_projection,
                                                    cv::Size image_size);

    // One synchronized checkerboard observation seen by both cameras.
    struct StereoView
    {
        std::vector<cv::Point3f> object_points;
        std::vector<cv::Point2f> image_points_left;
        std::vector<cv::Point2f> image_points_right;
    };

    // Full stereo calibration result: both cameras' intrinsics/distortion, the left->right
    // rigid transform, the disparity-to-depth Q matrix, and ready-to-use undistort maps.
    struct StereoCalibration
    {
        MonoCalibration left;
        MonoCalibration right;
        Pose left_to_right;
        cv::Mat disparity_to_depth_q;
        UndistortRectifyMap left_map;
        UndistortRectifyMap right_map;
    };

    // Runs per-camera calibration, stereoCalibrate (intrinsics held fixed), stereoRectify,
    // and builds both cameras' undistort/rectify maps in one call.
    StereoCalibration calibrate_stereo(const std::vector<StereoView> &views, cv::Size image_size);

} // namespace navlib::common::calibrate
