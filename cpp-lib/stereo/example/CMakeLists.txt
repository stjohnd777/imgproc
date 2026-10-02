add_executable(stereo_example main.cpp)
target_link_libraries(stereo_example PRIVATE navlib::stereo navlib::common)
