#include <gtest/gtest.h>

#include "common/common.hpp"

// Placeholder test to confirm the gtest + common wiring builds and runs.
TEST(CommonDummyTest, HelloWorld) { EXPECT_EQ(navlib::common::version(), "0.1.0"); }
