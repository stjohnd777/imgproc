cmake_minimum_required(VERSION 3.16)

project(fourier_cli LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(OpenCV REQUIRED COMPONENTS core imgproc imgcodecs)

add_executable(fourier_cli fourier_cli.cpp)
target_link_libraries(fourier_cli PRIVATE ${OpenCV_LIBS})

target_include_directories(fourier_cli PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../common)
