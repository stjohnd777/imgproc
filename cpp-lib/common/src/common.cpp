#include "common/common.hpp"

#include <spdlog/spdlog.h>

namespace navlib::common {

void init_logging(const std::string& logger_name) {
  spdlog::set_pattern("[%Y-%m-%d %H:%M:%S.%e] [%n] [%^%l%$] %v");
  spdlog::info("{} logging initialized", logger_name);
}

std::string version() { return "0.1.0"; }

} // namespace navlib::common
