#include <iostream>

#include "attitude/attitude.hpp"
#include "common/common.hpp"

int main() {
  navlib::common::init_logging("attitude_example");

  const auto result = navlib::attitude::estimate_attitude_hello_world();
  std::cout << "Hello, attitude! roll=" << result.roll_deg << " pitch=" << result.pitch_deg
            << " yaw=" << result.yaw_deg << '\n';

  return 0;
}
