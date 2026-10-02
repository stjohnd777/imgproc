add_executable(bearing_example main.cpp)
target_link_libraries(bearing_example PRIVATE navlib::bearing navlib::common)
