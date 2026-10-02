#include <gtest/gtest.h>

#include "stereo/stereo.hpp"

// Placeholder test to confirm the gtest + stereo lib wiring builds and runs.
TEST(StereoDummyTest, HelloWorld) {
  const auto result = navlib::stereo::estimate_stereo_hello_world();
  EXPECT_EQ(result.disparity, 0.0);
}
