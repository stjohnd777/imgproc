#include "bearing/bearing.hpp"

#include <spdlog/spdlog.h>

namespace navlib::bearing {

BearingResult estimate_bearing_hello_world() {
  spdlog::info("bearing: hello world stub called");
  return BearingResult{0.0};
}

} // namespace navlib::bearing
