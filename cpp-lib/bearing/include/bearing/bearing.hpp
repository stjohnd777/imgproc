#pragma once

namespace navlib::bearing
{

    // Placeholder result type; replace with the real bearing-estimation output.
    struct BearingResult
    {
        double degrees = 0.0;
    };

    BearingResult estimate_bearing_hello_world();

} // namespace navlib::bearing
