cmake_minimum_required(VERSION 3.16)

project(usb_camera_cli LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(OpenCV REQUIRED COMPONENTS core imgproc imgcodecs calib3d videoio)

add_executable(usb_camera_cli usb_camera_cli.cpp)
target_link_libraries(usb_camera_cli PRIVATE ${OpenCV_LIBS})

target_include_directories(usb_camera_cli PRIVATE
    ${OpenCV_INCLUDE_DIRS}
    ${CMAKE_CURRENT_SOURCE_DIR}/../common
)

include(CTest)
if(BUILD_TESTING)
    add_executable(capture_frames_test capture_frames_test.cpp)
    target_link_libraries(capture_frames_test PRIVATE ${OpenCV_LIBS})
    target_include_directories(capture_frames_test PRIVATE ${OpenCV_INCLUDE_DIRS})
    add_test(NAME usb_camera_capture_frames COMMAND capture_frames_test)
    add_test(NAME usb_camera_help COMMAND usb_camera_cli --help)
    add_test(NAME usb_camera_missing_arguments COMMAND usb_camera_cli)
    add_test(NAME usb_camera_invalid_device COMMAND usb_camera_cli invalid unused)
    add_test(NAME usb_camera_invalid_count COMMAND usb_camera_cli 0 unused 0)
    add_test(NAME usb_camera_incomplete_resolution COMMAND usb_camera_cli 0 unused 1 480)
    add_test(NAME usb_camera_invalid_resolution COMMAND usb_camera_cli 0 unused 1 -1 640)
    set_tests_properties(
        usb_camera_missing_arguments usb_camera_invalid_device
        usb_camera_invalid_count usb_camera_incomplete_resolution
        usb_camera_invalid_resolution
        PROPERTIES WILL_FAIL TRUE
    )
endif()
