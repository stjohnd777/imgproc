#pragma once

#include <string>

namespace navlib::common
{

    // Initializes the shared spdlog sink/pattern used across all verticals.
    void init_logging(const std::string &logger_name = "navlib");

    std::string version();

} // namespace navlib::common