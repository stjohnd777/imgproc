add_executable(bearing_tests dummy_test.cpp)
target_link_libraries(bearing_tests PRIVATE navlib::bearing GTest::gtest_main)

include(GoogleTest)
gtest_discover_tests(bearing_tests)
