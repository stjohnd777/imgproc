add_executable(stereo_tests dummy_test.cpp)
target_link_libraries(stereo_tests PRIVATE navlib::stereo GTest::gtest_main)

include(GoogleTest)
gtest_discover_tests(stereo_tests)
