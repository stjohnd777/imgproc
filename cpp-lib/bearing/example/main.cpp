#include <iostream>

#include "bearing/bearing.hpp"
#include "common/common.hpp"

int main() {
  navlib::common::init_logging("bearing_example");

  const auto result = navlib::bearing::estimate_bearing_hello_world();
  std::cout << "Hello, bearing! degrees=" << result.degrees << '\n';

  return 0;
}
