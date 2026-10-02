#pragma once

namespace navlib::attitude
{

    // Placeholder result type; replace with the real attitude (roll/pitch/yaw) output.
    struct AttitudeResult
    {
        double roll_deg = 0.0;
        double pitch_deg = 0.0;
        double yaw_deg = 0.0;
    };

    AttitudeResult estimate_attitude_hello_world();

} // namespace navlib::attitude
