add_executable(attitude_example main.cpp)
target_link_libraries(attitude_example PRIVATE navlib::attitude navlib::common)
