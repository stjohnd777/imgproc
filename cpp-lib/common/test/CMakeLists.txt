file(GLOB_RECURSE COMMON_TEST_SOURCES CONFIGURE_DEPENDS *.cpp)

add_executable(common_tests ${COMMON_TEST_SOURCES})
target_link_libraries(common_tests PRIVATE navlib::common GTest::gtest_main)

include(GoogleTest)
gtest_discover_tests(common_tests)
