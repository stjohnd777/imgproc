#include <gtest/gtest.h>

#include "attitude/attitude.hpp"

// Placeholder test to confirm the gtest + attitude lib wiring builds and runs.
TEST(AttitudeDummyTest, HelloWorld) {
  const auto result = navlib::attitude::estimate_attitude_hello_world();
  EXPECT_EQ(result.roll_deg, 0.0);
  EXPECT_EQ(result.pitch_deg, 0.0);
  EXPECT_EQ(result.yaw_deg, 0.0);
}
