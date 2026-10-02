#include "attitude/attitude.hpp"

#include <spdlog/spdlog.h>

namespace navlib::attitude {

AttitudeResult estimate_attitude_hello_world() {
  spdlog::info("attitude: hello world stub called");
  return AttitudeResult{0.0, 0.0, 0.0};
}

} // namespace navlib::attitude
