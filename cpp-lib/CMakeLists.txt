cmake_minimum_required(VERSION 3.20)
project(navlib CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

find_package(OpenCV REQUIRED COMPONENTS core imgproc imgcodecs videoio calib3d features2d)
find_package(Eigen3 REQUIRED)
find_package(nlohmann_json REQUIRED)
find_package(spdlog REQUIRED)
find_package(Crow REQUIRED)
find_package(GTest REQUIRED)

include(CTest)
enable_testing()

# common must come first: every vertical links against it
add_subdirectory(common)
add_subdirectory(bearing)
add_subdirectory(stereo)
add_subdirectory(attitude)
