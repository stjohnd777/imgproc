add_executable(stereo_server_tests dummy_test.cpp)
target_link_libraries(stereo_server_tests PRIVATE GTest::gtest_main)

include(GoogleTest)
gtest_discover_tests(stereo_server_tests)
