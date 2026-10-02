add_executable(attitude_tests dummy_test.cpp)
target_link_libraries(attitude_tests PRIVATE navlib::attitude GTest::gtest_main)

include(GoogleTest)
gtest_discover_tests(attitude_tests)
