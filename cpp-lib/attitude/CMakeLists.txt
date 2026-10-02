file(GLOB_RECURSE ATTITUDE_SOURCES CONFIGURE_DEPENDS src/*.cpp)
file(GLOB_RECURSE ATTITUDE_HEADERS CONFIGURE_DEPENDS include/*.hpp include/*.h)

add_library(navlib_attitude STATIC ${ATTITUDE_SOURCES} ${ATTITUDE_HEADERS})
add_library(navlib::attitude ALIAS navlib_attitude)

target_include_directories(navlib_attitude PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
)

target_link_libraries(navlib_attitude PUBLIC navlib::common)

add_subdirectory(test)
add_subdirectory(example)
add_subdirectory(server)
