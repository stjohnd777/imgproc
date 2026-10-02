#include "stereo/stereo.hpp"

#include <spdlog/spdlog.h>

namespace navlib::stereo {

StereoResult estimate_stereo_hello_world() {
  spdlog::info("stereo: hello world stub called");
  return StereoResult{0.0};
}

} // namespace navlib::stereo
