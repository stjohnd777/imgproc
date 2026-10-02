add_executable(bearing_server_tests dummy_test.cpp)
target_link_libraries(bearing_server_tests PRIVATE GTest::gtest_main)

include(GoogleTest)
gtest_discover_tests(bearing_server_tests)
