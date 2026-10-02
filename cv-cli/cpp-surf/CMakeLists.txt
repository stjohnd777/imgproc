cmake_minimum_required(VERSION 3.16)

project(surf_cli LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(OpenCV REQUIRED COMPONENTS core imgproc imgcodecs features2d xfeatures2d)

add_executable(surf_cli surf_cli.cpp)

target_link_libraries(surf_cli PRIVATE ${OpenCV_LIBS})

target_include_directories(surf_cli PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../common)

find_package(nlohmann_json REQUIRED)
target_link_libraries(surf_cli PRIVATE nlohmann_json::nlohmann_json)
