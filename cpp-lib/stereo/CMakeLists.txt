file(GLOB_RECURSE STEREO_SOURCES CONFIGURE_DEPENDS src/*.cpp)
file(GLOB_RECURSE STEREO_HEADERS CONFIGURE_DEPENDS include/*.hpp include/*.h)

add_library(navlib_stereo STATIC ${STEREO_SOURCES} ${STEREO_HEADERS})
add_library(navlib::stereo ALIAS navlib_stereo)

target_include_directories(navlib_stereo PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
)

target_link_libraries(navlib_stereo PUBLIC navlib::common)

add_subdirectory(test)
add_subdirectory(example)
add_subdirectory(server)
