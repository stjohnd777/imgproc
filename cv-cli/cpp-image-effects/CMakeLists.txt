cmake_minimum_required(VERSION 3.16)
project(image_effects LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(OpenCV REQUIRED COMPONENTS core imgproc imgcodecs calib3d)

foreach(tool distort add_noise bilateral clahe morphology image_diff)
    add_executable(${tool}_cli ${tool}_cli.cpp)
    target_include_directories(${tool}_cli PRIVATE ${OpenCV_INCLUDE_DIRS} ../common)
    target_link_libraries(${tool}_cli PRIVATE ${OpenCV_LIBS})
endforeach()

foreach(tool hconcat vconcat)
    add_executable(${tool}_cli concat_cli.cpp)
    target_include_directories(${tool}_cli PRIVATE ${OpenCV_INCLUDE_DIRS} ../common)
    target_link_libraries(${tool}_cli PRIVATE ${OpenCV_LIBS})
endforeach()
target_compile_definitions(hconcat_cli PRIVATE CONCAT_HORIZONTAL)
