#pragma once

#include <crow.h>

namespace navlib::stereo::server
{

    // Registers this vertical's REST routes onto the shared Crow app.
    void register_routes(crow::SimpleApp &app);

} // namespace navlib::stereo::server
