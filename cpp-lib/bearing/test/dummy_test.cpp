#include <gtest/gtest.h>

#include "bearing/bearing.hpp"

// Placeholder test to confirm the gtest + bearing lib wiring builds and runs.
TEST(BearingDummyTest, HelloWorld) {
  const auto result = navlib::bearing::estimate_bearing_hello_world();
  EXPECT_EQ(result.degrees, 0.0);
}
