cmake_minimum_required(VERSION 3.16)

project(canny_cli LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(OpenCV REQUIRED COMPONENTS core imgproc imgcodecs)

add_executable(canny_cli canny_cli.cpp)
target_link_libraries(canny_cli PRIVATE ${OpenCV_LIBS})

target_include_directories(canny_cli PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../common)
