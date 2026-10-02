#include <iostream>

#include "common/common.hpp"
#include "stereo/stereo.hpp"

int main() {
  navlib::common::init_logging("stereo_example");

  const auto result = navlib::stereo::estimate_stereo_hello_world();
  std::cout << "Hello, stereo! disparity=" << result.disparity << '\n';

  return 0;
}
