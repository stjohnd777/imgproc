cmake_minimum_required(VERSION 3.16)

project(gaussian_cli LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(OpenCV REQUIRED COMPONENTS core imgproc imgcodecs)

add_executable(gaussian_cli gaussian_cli.cpp)
target_link_libraries(gaussian_cli PRIVATE ${OpenCV_LIBS})

target_include_directories(gaussian_cli PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../common)
