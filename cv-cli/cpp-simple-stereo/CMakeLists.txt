cmake_minimum_required(VERSION 3.16)

project(simple_stereo_cli LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(OpenCV REQUIRED COMPONENTS core imgproc imgcodecs calib3d)

add_executable(simple_stereo_cli simple_stereo_cli.cpp)
target_link_libraries(simple_stereo_cli PRIVATE ${OpenCV_LIBS})

target_include_directories(simple_stereo_cli PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../common
    /opt/homebrew/include
)
