#pragma once

namespace navlib::stereo
{

    // Placeholder result type; replace with the real stereo-vision output (e.g. depth map).
    struct StereoResult
    {
        double disparity = 0.0;
    };

    StereoResult estimate_stereo_hello_world();

} // namespace navlib::stereo
