cmake_minimum_required(VERSION 3.16)

project(undistort_cli LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(OpenCV REQUIRED COMPONENTS core imgproc imgcodecs calib3d)

add_executable(undistort_cli undistort_cli.cpp)
target_link_libraries(undistort_cli PRIVATE ${OpenCV_LIBS})

target_include_directories(undistort_cli PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../common)
